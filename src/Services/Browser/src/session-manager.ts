import { BrowserClaw, type CrawlPage } from 'browserclaw';
import type { ServerResponse } from 'node:http';
import { HttpError } from './types.js';
import type { Session, SessionStatus, AgentLoopResult, SkillOutput } from './types.js';
import { runAgentLoop } from './agent-loop.js';
import { generateSkill } from './skill-generator.js';
import { moderatePrompt } from './content-policy.js';
import { logPrompt } from './prompt-log.js';
import { requireEnvInt } from './config.js';

interface ManagedSession {
  id: string;
  prompt: string;
  ip: string;
  modelId: string;
  browser: BrowserClaw;
  page: CrawlPage;
  cdpPort: number;
  status: SessionStatus;
  createdAt: Date;
  lastActivityAt: Date;
  sseClients: Set<ServerResponse>;
  result: AgentLoopResult | null;
  skill: SkillOutput | null;
  abortController: AbortController;
}

const MAX_SESSIONS = requireEnvInt('MAX_SESSIONS', 10);
const MAX_SESSIONS_PER_IP = requireEnvInt('MAX_SESSIONS_PER_IP', 1);
const SESSION_IDLE_TIMEOUT_MS = requireEnvInt('SESSION_IDLE_TIMEOUT_MS', 900_000);
const SESSION_MAX_DURATION_MS = requireEnvInt('SESSION_MAX_DURATION_MS', 300_000);
const BASE_CDP_PORT = 9222;
const MIN_STEPS_FOR_SKILL = 3;
const AUTO_CLOSE_DELAY_MS = 10_000;
const NON_ACTION_TYPES = new Set(['done', 'wait', 'fail']);

const sessions = new Map<string, ManagedSession>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function nextAvailableCdpPort(): number {
  const usedPorts = new Set([...sessions.values()].map(s => s.cdpPort));
  let port = BASE_CDP_PORT;
  while (usedPorts.has(port)) port++;
  return port;
}

function getManagedSession(sessionId: string): ManagedSession {
  const session = sessions.get(sessionId);
  if (!session) throw new HttpError(404, `Session ${sessionId} not found`);
  return session;
}

export function emitSSE(sessionId: string, event: string, data: unknown): void {
  const managed = sessions.get(sessionId);
  if (!managed) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of managed.sseClients) {
    client.write(payload);
  }
}

export function addSSEClient(sessionId: string, res: ServerResponse): void {
  const managed = getManagedSession(sessionId);
  managed.sseClients.add(res);
  res.on('close', () => {
    managed.sseClients.delete(res);
  });
}

export function startCleanupLoop(): void {
  cleanupInterval = setInterval(async () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      const age = now - session.createdAt.getTime();
      const idle = now - session.lastActivityAt.getTime();
      if (age > SESSION_MAX_DURATION_MS) {
        console.log(`Closing session ${id} — exceeded max duration (${Math.round(age / 1000)}s)`);
        emitSSE(id, 'timeout', { reason: 'Session time limit reached (5 minutes)' });
        await closeSession(id);
      } else if (idle > SESSION_IDLE_TIMEOUT_MS) {
        console.log(`Closing idle session ${id}`);
        await closeSession(id);
      }
    }
  }, 5_000);
}

export function stopCleanupLoop(): void {
  if (cleanupInterval) clearInterval(cleanupInterval);
}

export async function createSession(
  prompt: string,
  url: string,
  headless: boolean,
  ip: string,
  modelId: string,
  skipModeration?: boolean,
): Promise<{ session: Session }> {
  if (sessions.size >= MAX_SESSIONS) {
    throw new HttpError(429, `Maximum concurrent sessions (${MAX_SESSIONS}) reached`);
  }

  const ipSessionCount = [...sessions.values()].filter(s => s.ip === ip).length;
  if (ipSessionCount >= MAX_SESSIONS_PER_IP) {
    throw new HttpError(429, 'You already have a session running. Wait for it to finish.');
  }

  if (!skipModeration) {
    const aiCheck = await moderatePrompt(prompt);
    if (!aiCheck.allowed) {
      throw new HttpError(422, aiCheck.reason ?? 'Prompt blocked by content policy.');
    }
  }

  const cdpPort = nextAvailableCdpPort();

  const browser = await BrowserClaw.launch({
    headless,
    noSandbox: process.platform === 'linux',
    cdpPort,
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: process.env.SSRF_ALLOW_PRIVATE === 'true',
    },
    chromeArgs: [
      '--disable-blink-features=AutomationControlled',
      '--disable-downloads',
      '--disable-file-system',
      ...(headless ? [] : ['--start-maximized']),
    ],
  });

  let page: CrawlPage;
  try {
    page = await browser.currentPage();
    await page.goto(url);
  } catch (err) {
    console.error(`Failed to open URL ${url} — stopping orphaned Chrome:`, err);
    await browser.stop().catch((stopErr) => {
      console.error(`Failed to stop orphaned Chrome for ${url}:`, stopErr);
    });
    throw err;
  }

  const now = new Date();
  const id = crypto.randomUUID().replace(/-/g, '');

  const managed: ManagedSession = {
    id,
    prompt,
    ip,
    modelId,
    browser,
    page,
    cdpPort,
    status: 'pending',
    createdAt: now,
    lastActivityAt: now,
    sseClients: new Set(),
    result: null,
    skill: null,
    abortController: new AbortController(),
  };

  sessions.set(id, managed);
  console.log(`Created session ${id} (CDP port ${cdpPort})`);

  logPrompt({
    timestamp: now.toISOString(),
    session_id: id,
    ip,
    prompt,
    url,
    status: 'started',
  });

  startAgentLoop(id).catch((err) => {
    console.error(`Agent loop failed for session ${id}:`, err);
  });

  return {
    session: {
      id,
      prompt,
      created_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      status: 'pending',
      max_duration_ms: SESSION_MAX_DURATION_MS,
    },
  };
}

async function startAgentLoop(sessionId: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  managed.status = 'running';

  const emitter = (event: string, data: unknown) => {
    managed.lastActivityAt = new Date();
    emitSSE(sessionId, event, data);
  };

  try {
    const result = await runAgentLoop(
      managed.prompt,
      managed.page,
      emitter,
      managed.abortController.signal,
      managed.modelId,
    );

    managed.result = result;
    managed.status = result.success ? 'completed' : 'failed';

    logPrompt({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      ip: managed.ip,
      prompt: managed.prompt,
      url: result.final_url ?? '',
      status: result.success ? 'completed' : 'failed',
      steps: result.steps.length,
      duration_ms: result.duration_ms,
      error: result.error,
    });

    if (result.success) {
      await tryGenerateSkill(managed, emitter);
      emitter('completed', {
        steps_completed: result.steps.length,
        duration_ms: result.duration_ms,
        answer: result.answer,
      });
    } else {
      emitter('failed', {
        step: result.steps.length,
        error: result.error,
      });
    }
  } catch (err) {
    managed.status = 'failed';
    const message = err instanceof Error ? err.message : 'Agent loop crashed';
    console.error(`Agent loop crashed for session ${sessionId}:`, message);
    emitter('failed', { step: 0, error: message });
  }

  setTimeout(() => {
    closeSession(sessionId).catch((err) => {
      console.error(`Auto-close failed for session ${sessionId}:`, err);
    });
  }, AUTO_CLOSE_DELAY_MS);
}

async function tryGenerateSkill(
  managed: ManagedSession,
  emitter: (event: string, data: unknown) => void,
): Promise<void> {
  const result = managed.result;
  if (!result) return;

  const actionSteps = result.steps.filter(s => !NON_ACTION_TYPES.has(s.action.action));
  if (actionSteps.length < MIN_STEPS_FOR_SKILL) return;

  try {
    const skill = await generateSkill(managed.prompt, result, managed.modelId);
    managed.skill = skill;
    emitter('skill_generated', { skill });
  } catch (err) {
    console.error(`Skill generation failed for session ${managed.id}:`, err);
  }
}

export function getSession(sessionId: string): Session {
  const managed = getManagedSession(sessionId);
  return {
    id: managed.id,
    prompt: managed.prompt,
    created_at: managed.createdAt.toISOString(),
    last_activity_at: managed.lastActivityAt.toISOString(),
    status: managed.status,
  };
}

export function getSessionResult(sessionId: string): { result: AgentLoopResult | null; skill: SkillOutput | null } {
  const managed = getManagedSession(sessionId);
  return { result: managed.result, skill: managed.skill };
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.abortController.abort();
  sessions.delete(sessionId);

  for (const client of session.sseClients) {
    client.end();
  }

  try {
    await session.browser.stop();
  } catch (err) {
    console.error(`Failed to stop browser for session ${sessionId}:`, err);
  }
  console.log(`Closed session ${sessionId}`);
}

export async function closeAllSessions(): Promise<void> {
  for (const id of sessions.keys()) {
    await closeSession(id);
  }
}

export function sessionCount(): number {
  return sessions.size;
}
