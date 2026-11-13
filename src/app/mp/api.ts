import * as v from 'valibot';
import { newActionId } from '../../shared/mp/codes';
import { ApiErrorSchema, LobbyEnvelopeSchema } from '../../shared/mp/schemas';
import type { BuildDraft, LobbySettings, LobbyView } from '../../shared/mp/types';

const TIMEOUT_MS = 8000;
const RETRIES = 3;

export class MpError extends Error {
  status: number;
  reason: string;

  constructor(message: string, status: number, reason: string) {
    super(message);
    this.name = 'MpError';
    this.status = status;
    this.reason = reason;
  }
}

export function isFatal(error: unknown): boolean {
  return error instanceof MpError && (error.status === 403 || error.status === 404);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function once(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request(path: string, init: RequestInit, retries = RETRIES): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await once(path, init);
      if (response.status >= 500 && attempt < retries) {
        await delay(300 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(300 * (attempt + 1));
    }
  }
  throw new MpError(lastError instanceof Error ? lastError.message : 'Network error', 0, 'server');
}

async function parseView(response: Response): Promise<LobbyView> {
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    let reason = 'server';
    try {
      const parsed = v.safeParse(ApiErrorSchema, await response.json());
      if (parsed.success) {
        message = parsed.output.error;
        reason = parsed.output.reason;
      }
    } catch {
      message = `Request failed (${response.status}).`;
    }
    throw new MpError(message, response.status, reason);
  }
  const parsed = v.safeParse(LobbyEnvelopeSchema, await response.json());
  if (!parsed.success) throw new MpError('That lobby sent an unexpected response.', 500, 'server');
  return parsed.output.lobby as unknown as LobbyView;
}

function authHeaders(secret: string): Record<string, string> {
  return { authorization: `Bearer ${secret}` };
}

function postInit(secret: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret) },
    body: JSON.stringify(body),
  };
}

export async function createLobbyRequest(name: string, secret: string, settings: LobbySettings): Promise<LobbyView> {
  const response = await request('/api/lobby', postInit(secret, { name, actionId: newActionId(), settings }));
  return parseView(response);
}

export async function joinLobbyRequest(code: string, name: string, secret: string): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/join`, postInit(secret, { name, actionId: newActionId() }));
  return parseView(response);
}

export async function fetchLobbyRequest(code: string, secret: string, since: number): Promise<LobbyView | null> {
  const response = await request(`/api/lobby/${code}?since=${since}`, { headers: authHeaders(secret) }, 0);
  if (response.status === 204) return null;
  return parseView(response);
}

export async function startLobbyRequest(code: string, secret: string, settings: LobbySettings): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/start`, postInit(secret, { actionId: newActionId(), settings }));
  return parseView(response);
}

export async function syncDraftRequest(code: string, secret: string, draft: BuildDraft): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/build`, postInit(secret, { actionId: newActionId(), draft }), 1);
  return parseView(response);
}

export async function submitBuildRequest(code: string, secret: string, draft: BuildDraft): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/submit`, postInit(secret, { actionId: newActionId(), draft }));
  return parseView(response);
}

export async function releaseRequest(code: string, secret: string, force: boolean): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/release`, postInit(secret, { actionId: newActionId(), force }));
  return parseView(response);
}

export async function leaveLobbyRequest(code: string, secret: string): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/leave`, postInit(secret, { actionId: newActionId() }));
  return parseView(response);
}
