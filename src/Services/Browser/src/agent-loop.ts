import type { CrawlPage } from 'browserclaw';
import { llmJson } from './llm.js';
import type { AgentAction, AgentStep, AgentLoopResult } from './types.js';
import {
  MAX_AGENT_STEPS,
  WAIT_AFTER_TYPE_MS,
  WAIT_AFTER_CLICK_MS,
  WAIT_AFTER_OTHER_MS,
  WAIT_ACTION_MS,
  SCROLL_PIXELS,
  LLM_MAX_TOKENS,
} from './config.js';

const SYSTEM_PROMPT = `You are a browser automation agent. You receive an accessibility snapshot of a web page and must decide the next action to take.

You MUST respond with valid JSON matching this schema:
{
  "reasoning": "brief explanation of what you're doing and why",
  "action": "click" | "type" | "navigate" | "select" | "scroll" | "wait" | "done" | "fail",
  "ref": "element ref number (for click, type, select)",
  "text": "text to type (for type action)",
  "url": "URL to navigate to (for navigate action)",
  "options": ["option values (for select action)"],
  "direction": "up" | "down" (for scroll action),
  "answer": "the answer to the user's question (only when action is done and the task asked a question)"
}

Rules:
- Use "done" when the task is complete.
- Use "fail" when the task cannot be completed (explain why in reasoning).
- Use exact ref numbers from the snapshot.
- Type action clears the field first, then types the text.
- Be concise in reasoning.
- Do not repeat failed actions — try a different approach.
- When the task asks a question (e.g. "what is", "find", "check the price"), include the answer in the "answer" field when using "done". The answer should directly address the user's question with the specific information found.
- Pay close attention to toasts, alerts, banners, notifications, error messages, and status updates in the snapshot. These contain critical feedback about whether your actions succeeded or failed (e.g. "Item added to cart", "Invalid email", "Please complete CAPTCHA"). React to them — if an error toast appears, adjust your approach instead of repeating the same action.
- Look for cookie consent banners, login walls, and popups that block the page. Dismiss them before proceeding with the task.
- After typing into any input field, ALWAYS check the next snapshot for a dropdown/listbox/suggestions that appeared. Many fields are autocomplete — airports, cities, addresses, products, emails, etc. If a dropdown appeared, you MUST click the correct option to confirm your selection. Just typing the text is NOT enough — the field is not set until you select from the dropdown. If you're unsure whether a dropdown will appear, use a "wait" action after typing to give it time to load, then check the snapshot.
- After submitting a form or clicking a button, check the snapshot for validation errors before moving on. If the page shows errors (red text, error icons, warning banners), fix the issues first.`;

function buildUserMessage(prompt: string, snapshot: string, history: AgentStep[], url: string, title: string): string {
  let message = `Task: ${prompt}\n\nCurrent page: ${title}\nURL: ${url}\n\n`;

  if (history.length > 0) {
    message += 'Previous actions:\n';
    for (const step of history) {
      message += `  Step ${step.step}: ${step.action.action} — ${step.action.reasoning}\n`;
    }
    message += '\n';
  }

  const alertLines = snapshot
    .split('\n')
    .filter(line => /\b(alert|status|dialog|banner|toast|notification|error|warning)\b/i.test(line))
    .map(line => line.trim())
    .filter(Boolean);

  if (alertLines.length > 0) {
    message += `⚠ Active alerts/notifications on page:\n${alertLines.join('\n')}\n\n`;
  }

  message += `Page snapshot:\n${snapshot}`;

  return message;
}

function parseAction(parsed: Record<string, unknown>): AgentAction {
  if (!parsed.action || !parsed.reasoning) {
    throw new Error('Response missing required fields: action, reasoning');
  }

  return {
    action: parsed.action as AgentAction['action'],
    reasoning: parsed.reasoning as string,
    answer: parsed.answer as string | undefined,
    ref: parsed.ref as string | undefined,
    text: parsed.text as string | undefined,
    url: parsed.url as string | undefined,
    options: parsed.options as string[] | undefined,
    direction: parsed.direction as AgentAction['direction'],
  };
}

async function executeAction(action: AgentAction, page: CrawlPage): Promise<void> {
  switch (action.action) {
    case 'click':
      if (!action.ref) throw new Error('click action requires ref');
      await page.click(action.ref);
      break;

    case 'type':
      if (!action.ref) throw new Error('type action requires ref');
      if (!action.text) throw new Error('type action requires text');
      await page.type(action.ref, action.text, { submit: false });
      break;

    case 'navigate':
      if (!action.url) throw new Error('navigate action requires url');
      await page.goto(action.url);
      break;

    case 'select':
      if (!action.ref) throw new Error('select action requires ref');
      if (!action.options || action.options.length === 0) throw new Error('select action requires options');
      await page.select(action.ref, ...action.options);
      break;

    case 'scroll':
      await page.evaluate(
        action.direction === 'up'
          ? `window.scrollBy(0, -${SCROLL_PIXELS})`
          : `window.scrollBy(0, ${SCROLL_PIXELS})`,
      );
      break;

    case 'wait':
      await page.waitFor({ timeMs: WAIT_ACTION_MS });
      break;

    case 'done':
    case 'fail':
      break;

    default:
      throw new Error(`Unknown action: ${action.action}`);
  }
}

function getWaitMs(action: AgentAction['action']): number {
  switch (action) {
    case 'type':  return WAIT_AFTER_TYPE_MS;
    case 'click': return WAIT_AFTER_CLICK_MS;
    default:      return WAIT_AFTER_OTHER_MS;
  }
}

export async function runAgentLoop(
  prompt: string,
  page: CrawlPage,
  emit: (event: string, data: unknown) => void,
  signal: AbortSignal,
  modelId: string,
): Promise<AgentLoopResult> {
  const history: AgentStep[] = [];
  const startTime = Date.now();

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    if (signal.aborted) {
      return {
        success: false,
        steps: history,
        error: 'Session was cancelled',
        duration_ms: Date.now() - startTime,
      };
    }

    const { snapshot } = await page.snapshot({ interactive: true, compact: true });
    const url = await page.url();
    const title = await page.title();

    emit('thinking', { step, message: `Analyzing page: ${title}` });

    const userMessage = buildUserMessage(prompt, snapshot, history, url, title);

    let action: AgentAction;
    try {
      const parsed = await llmJson<Record<string, unknown>>({
        modelId,
        system: SYSTEM_PROMPT,
        message: userMessage,
        maxTokens: LLM_MAX_TOKENS,
      });
      action = parseAction(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse action';
      console.error(`Step ${step}: failed to parse LLM response:`, message);
      emit('step_error', { step, error: `LLM response error: ${message}` });
      continue;
    }

    const agentStep: AgentStep = {
      step,
      action,
      snapshot_text: snapshot,
      url,
      page_title: title,
      timestamp: new Date().toISOString(),
    };

    history.push(agentStep);

    emit('step', {
      step,
      action: action.action,
      reasoning: action.reasoning,
      url,
      page_title: title,
    });

    if (action.action === 'done') {
      return {
        success: true,
        steps: history,
        answer: action.answer,
        duration_ms: Date.now() - startTime,
        final_url: url,
      };
    }

    if (action.action === 'fail') {
      return {
        success: false,
        steps: history,
        error: action.reasoning,
        duration_ms: Date.now() - startTime,
        final_url: url,
      };
    }

    try {
      await executeAction(action, page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action execution failed';
      console.error(`Step ${step}: action ${action.action} failed:`, message);
      emit('step_error', { step, action: action.action, error: message });
    }

    const waitMs = getWaitMs(action.action);
    await page.waitFor({ timeMs: waitMs });
  }

  return {
    success: false,
    steps: history,
    error: `Reached maximum steps (${MAX_AGENT_STEPS})`,
    duration_ms: Date.now() - startTime,
  };
}
