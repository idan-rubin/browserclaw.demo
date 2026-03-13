import OpenAI from 'openai';
import { parseJsonResponse } from './parse-json-response.js';

export interface ModelConfig {
  id: string;
  label: string;
  provider: string;
  model: string;
  baseURL: string;
  apiKeyEnv: string;
}

const ALL_MODELS: ModelConfig[] = [
  {
    id: 'groq-llama-3.3-70b',
    label: 'Llama 3.3 70B (Groq)',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    provider: 'openai',
    model: 'gpt-5.4',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
];

const clientCache = new Map<string, OpenAI>();

function getClient(config: ModelConfig): OpenAI {
  const cached = clientCache.get(config.id);
  if (cached) return cached;

  const client = new OpenAI({
    apiKey: process.env[config.apiKeyEnv],
    baseURL: config.baseURL,
  });
  clientCache.set(config.id, client);
  return client;
}

export function getAvailableModels(): ModelConfig[] {
  return ALL_MODELS.filter(m => Boolean(process.env[m.apiKeyEnv]));
}

export function getModel(): ModelConfig {
  const modelId = process.env.MODEL;
  if (!modelId) {
    throw new Error(`MODEL is required. Valid: ${ALL_MODELS.map(m => m.id).join(', ')}`);
  }
  return resolveModel(modelId);
}

function resolveModel(modelId: string): ModelConfig {
  const found = ALL_MODELS.find(m => m.id === modelId);
  if (!found) throw new Error(`Unknown model: ${modelId}. Valid: ${ALL_MODELS.map(m => m.id).join(', ')}`);
  const apiKey = process.env[found.apiKeyEnv];
  if (!apiKey) throw new Error(`Model ${modelId} requires ${found.apiKeyEnv} to be set`);
  return found;
}

export interface LLMRequest {
  modelId: string;
  system: string;
  message: string;
  maxTokens: number;
}

interface LLMResponse {
  text: string;
}

async function callOpenAICompatible(config: ModelConfig, req: LLMRequest): Promise<LLMResponse> {
  const client = getClient(config);
  const useMaxCompletionTokens = config.provider === 'openai';

  const response = await client.chat.completions.create({
    model: config.model,
    ...(useMaxCompletionTokens ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.message },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');
  return { text: content };
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('429') || msg.includes('rate limit')
    || msg.includes('503') || msg.includes('overloaded');
}

export async function llm(req: LLMRequest): Promise<LLMResponse> {
  const config = resolveModel(req.modelId);
  try {
    return await callOpenAICompatible(config, req);
  } catch (err) {
    const fallbackId = process.env.FALLBACK_MODEL;
    if (fallbackId && isRetryable(err)) {
      const fallback = resolveModel(fallbackId);
      console.log(`${config.id} failed (${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}), falling back to ${fallback.id}`);
      return callOpenAICompatible(fallback, { ...req, modelId: fallbackId });
    }
    throw err;
  }
}

export async function llmJson<T>(req: LLMRequest): Promise<T> {
  const { text } = await llm(req);
  return parseJsonResponse<T>(text);
}
