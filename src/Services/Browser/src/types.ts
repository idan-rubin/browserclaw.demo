export interface Session {
  id: string;
  prompt: string;
  created_at: string;
  last_activity_at: string;
  status: SessionStatus;
  max_duration_ms?: number;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CreateSessionRequest {
  prompt: string;
  url?: string;
  headless?: boolean;
  skip_moderation?: boolean;
}

export type AgentActionType = 'click' | 'type' | 'navigate' | 'select' | 'scroll' | 'wait' | 'done' | 'fail';

export interface AgentAction {
  action: AgentActionType;
  reasoning: string;
  answer?: string;
  ref?: string;
  text?: string;
  url?: string;
  options?: string[];
  direction?: 'up' | 'down';
}

export interface AgentStep {
  step: number;
  action: AgentAction;
  snapshot_text?: string;
  url?: string;
  page_title?: string;
  timestamp: string;
}

export interface SkillOutput {
  title: string;
  description: string;
  steps: SkillStep[];
  metadata: SkillMetadata;
  markdown: string;
}

export interface SkillStep {
  number: number;
  description: string;
  action: AgentActionType;
  details?: string;
}

export interface SkillMetadata {
  prompt: string;
  url: string;
  total_steps: number;
  duration_ms: number;
  generated_at: string;
}

export interface AgentLoopResult {
  success: boolean;
  steps: AgentStep[];
  answer?: string;
  error?: string;
  duration_ms: number;
  final_url?: string;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
