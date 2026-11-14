import * as v from 'valibot';
import { newActionId } from '../../shared/mp/codes';
import { ApiErrorSchema, LobbyDeltaSchema, LobbyEnvelopeSchema } from '../../shared/mp/schemas';
import type { LobbyBuild, LobbyDelta, LobbySettings, LobbyView } from '../../shared/mp/types';

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

export type LobbyUpdate = { kind: 'view'; view: LobbyView } | { kind: 'delta'; delta: LobbyDelta };

async function failure(response: Response): Promise<MpError> {
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
  return new MpError(message, response.status, reason);
}

async function parseView(response: Response): Promise<LobbyView> {
  if (!response.ok) throw await failure(response);
  const parsed = v.safeParse(LobbyEnvelopeSchema, await response.json());
  if (!parsed.success) throw new MpError('That lobby sent an unexpected response.', 500, 'server');
  return parsed.output.lobby as unknown as LobbyView;
}

async function parseUpdate(response: Response): Promise<LobbyUpdate> {
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { lobby?: unknown; delta?: unknown };
  if (body.lobby !== undefined) {
    const parsed = v.safeParse(LobbyEnvelopeSchema, body);
    if (!parsed.success) throw new MpError('That lobby sent an unexpected response.', 500, 'server');
    return { kind: 'view', view: parsed.output.lobby as unknown as LobbyView };
  }
  const parsed = v.safeParse(LobbyDeltaSchema, body.delta);
  if (!parsed.success) throw new MpError('That lobby sent an unexpected response.', 500, 'server');
  return { kind: 'delta', delta: parsed.output as unknown as LobbyDelta };
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

export async function fetchLobbyRequest(
  code: string,
  secret: string,
  since: number,
  token: string,
  events: number,
  waiting: boolean,
  cursor: number | null,
  stage: number | null,
): Promise<LobbyUpdate | null> {
  const query = new URLSearchParams({ since: String(since), events: String(events) });
  if (token) query.set('token', token);
  if (waiting) query.set('waiting', '1');
  if (cursor !== null) query.set('cursor', String(cursor));
  if (stage !== null) query.set('stage', String(stage));
  const response = await request(`/api/lobby/${code}?${query.toString()}`, { headers: authHeaders(secret) }, 0);
  if (response.status === 204) return null;
  return parseUpdate(response);
}

export async function startLobbyRequest(code: string, secret: string, settings: LobbySettings): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/start`, postInit(secret, { actionId: newActionId(), settings }));
  return parseView(response);
}

export async function drawRequest(code: string, secret: string): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/draw`, postInit(secret, { actionId: newActionId() }));
  return parseView(response);
}

export async function rerollRequest(code: string, secret: string): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/reroll`, postInit(secret, { actionId: newActionId() }));
  return parseView(response);
}

export async function lockRequest(code: string, secret: string): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/lock`, postInit(secret, { actionId: newActionId() }));
  return parseView(response);
}

export async function submitBuildRequest(code: string, secret: string, build: LobbyBuild): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/build`, postInit(secret, { actionId: newActionId(), build }));
  return parseView(response);
}

export async function readyRequest(code: string, secret: string, stage: number): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/ready`, postInit(secret, { actionId: newActionId(), stage }));
  return parseView(response);
}

export async function advanceRequest(code: string, secret: string, stage: number): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/advance`, postInit(secret, { actionId: newActionId(), stage }));
  return parseView(response);
}

export async function rematchRequest(code: string, secret: string): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/rematch`, postInit(secret, { actionId: newActionId() }));
  return parseView(response);
}

export async function powerRequest(
  code: string,
  secret: string,
  power: 'shuffle' | 'scout',
  target: { kind: 'column'; index: number } | { kind: 'row'; tier: number } | { cardId: string },
): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/power`, postInit(secret, { actionId: newActionId(), power, target }));
  return parseView(response);
}

export async function removePlayerRequest(code: string, secret: string, seat: number): Promise<LobbyView> {
  const response = await request(`/api/lobby/${code}/remove`, postInit(secret, { actionId: newActionId(), seat }));
  return parseView(response);
}

export async function leaveLobbyRequest(code: string, secret: string): Promise<void> {
  const response = await request(`/api/lobby/${code}/leave`, postInit(secret, { actionId: newActionId() }));
  if (response.ok || response.status === 403 || response.status === 404) return;
  throw new MpError(`Could not leave the lobby (${response.status}).`, response.status, 'server');
}
