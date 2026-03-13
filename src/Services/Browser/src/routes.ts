import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createSession,
  getSession,
  getSessionResult,
  closeSession,
  addSSEClient,
  sessionCount,
} from './session-manager.js';
import { getModel } from './llm.js';
import { HttpError } from './types.js';
import type { CreateSessionRequest } from './types.js';

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON in request body');
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error_code: 'BROWSER_ERROR', message });
}

interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  clientIp: string;
}

type Handler = (ctx: RouteContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/health$/,
    paramNames: [],
    handler: async ({ res }) => {
      json(res, 200, {
        status: 'healthy',
        service: 'browserclaw-browser',
        sessions: sessionCount(),
      });
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/v1\/sessions$/,
    paramNames: [],
    handler: async ({ req, res, clientIp }) => {
      const body = await parseBody<CreateSessionRequest>(req);

      if (!body.prompt || body.prompt.trim().length === 0) {
        sendError(res, 400, 'prompt is required');
        return;
      }

      const url = body.url || 'https://www.google.com';
      const envForcesVisible = process.env.BROWSER_HEADLESS === 'false';
      const headless = envForcesVisible ? false : (body.headless ?? true);

      const modelId = getModel().id;

      const { session } = await createSession(
        body.prompt, url, headless, clientIp,
        modelId, body.skip_moderation,
      );

      json(res, 201, {
        session_id: session.id,
        status: session.status,
        created_at: session.created_at,
      });
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/v1\/sessions\/([^/]+)\/stream$/,
    paramNames: ['id'],
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      getSession(sessionId); // throws 404 if session doesn't exist

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      res.write(`event: connected\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`);
      addSSEClient(sessionId, res);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);

      res.on('close', () => {
        clearInterval(heartbeat);
      });
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/v1\/sessions\/([^/]+)$/,
    paramNames: ['id'],
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      const session = getSession(sessionId);
      const { result, skill } = getSessionResult(sessionId);

      json(res, 200, {
        ...session,
        result: result ? {
          success: result.success,
          steps_completed: result.steps.length,
          duration_ms: result.duration_ms,
          error: result.error,
          final_url: result.final_url,
        } : null,
        skill,
      });
    },
  },

  {
    method: 'DELETE',
    pattern: /^\/api\/v1\/sessions\/([^/]+)$/,
    paramNames: ['id'],
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      await closeSession(sessionId);
      json(res, 200, { success: true });
    },
  },
];

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  clientIp: string = '127.0.0.1',
): Promise<void> {
  const method = req.method ?? 'GET';
  const path = req.url?.split('?')[0] ?? '/';

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (!match) continue;

    const params: Record<string, string> = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      params[route.paramNames[i]] = match[i + 1];
    }

    try {
      await route.handler({ req, res, params, clientIp });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const status = err instanceof HttpError ? err.statusCode : 500;
      console.error(`Error handling ${method} ${path}:`, message);
      sendError(res, status, message);
    }
    return;
  }

  sendError(res, 404, `Unknown route: ${method} ${path}`);
}
