import * as v from 'valibot';
import { isCode, normalizeCode } from '../shared/mp/codes';
import type { ApiErrorBody } from '../shared/mp/types';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function errorResponse(status: number, reason: ApiErrorBody['reason'], message: string): Response {
  const body: ApiErrorBody = { error: message, reason };
  return jsonResponse(body, status);
}

export function codeFromPath(request: Request, index: number): string | null {
  try {
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    return segments[index] ?? null;
  } catch {
    return null;
  }
}

export function secretFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^bearer\s+([0-9a-f]{32})$/i.exec(header.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function lobbyRoute(request: Request): { ok: true; code: string; secret: string } | { ok: false; response: Response } {
  const raw = codeFromPath(request, 2);
  if (!raw) return { ok: false, response: errorResponse(400, 'invalid', 'Missing lobby code.') };
  const code = normalizeCode(raw);
  if (!isCode(code)) return { ok: false, response: errorResponse(400, 'invalid', 'Lobby codes are 6 characters.') };
  const secret = secretFromRequest(request);
  if (!secret) return { ok: false, response: errorResponse(401, 'forbidden', 'Missing participant secret.') };
  return { ok: true, code, secret };
}

export async function readBody<TInput, TOutput>(
  request: Request,
  schema: v.GenericSchema<TInput, TOutput>,
): Promise<{ ok: true; value: TOutput } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: errorResponse(400, 'invalid', 'Request body must be JSON.') };
  }
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) {
    const issue = parsed.issues[0];
    const path = issue?.path?.map((segment) => String(segment.key)).join('.') ?? '';
    return {
      ok: false,
      response: errorResponse(400, 'invalid', `Invalid request${path ? ` at ${path}` : ''}: ${issue?.message ?? 'schema'}`),
    };
  }
  return { ok: true, value: parsed.output };
}

export function methodNotAllowed(allowed = 'POST'): Response {
  return new Response(JSON.stringify({ error: 'Method not allowed', reason: 'invalid' } satisfies ApiErrorBody), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: allowed },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
