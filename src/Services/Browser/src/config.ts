import { getAvailableModels, getModel } from './llm.js';

export function requireEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.error(`FATAL: ${name} must be a number, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

// Agent timing (ms)
export const WAIT_AFTER_TYPE_MS = requireEnvInt('WAIT_AFTER_TYPE_MS', 1500);
export const WAIT_AFTER_CLICK_MS = requireEnvInt('WAIT_AFTER_CLICK_MS', 1000);
export const WAIT_AFTER_OTHER_MS = requireEnvInt('WAIT_AFTER_OTHER_MS', 500);
export const WAIT_ACTION_MS = requireEnvInt('WAIT_ACTION_MS', 2000);
export const MAX_AGENT_STEPS = requireEnvInt('MAX_AGENT_STEPS', 50);
export const SCROLL_PIXELS = 500;
export const LLM_MAX_TOKENS = 1024;

interface ServerConfig {
  port: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  internalToken: string | undefined;
}

export function validateConfig(): ServerConfig {
  const models = getAvailableModels();
  if (models.length === 0) {
    console.error('FATAL: No AI models available. Set at least one API key: GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY');
    process.exit(1);
  }
  console.log(`Available models: ${models.map(m => m.id).join(', ')}`);

  // Validate MODEL env var at startup so we fail fast, not on first request
  const model = getModel();
  console.log(`Active model: ${model.id}`);

  return {
    port: requireEnvInt('PORT', 5040),
    rateLimitMax: requireEnvInt('RATE_LIMIT_MAX', 20),
    rateLimitWindowMs: requireEnvInt('RATE_LIMIT_WINDOW_MS', 86_400_000),
    internalToken: process.env.BROWSER_INTERNAL_TOKEN,
  };
}
