import { cleanName } from '../shared/mp/codes.js';
import {
  ActionBodySchema,
  BuildBodySchema,
  JoinBodySchema,
  PowerBodySchema,
  RemoveBodySchema,
  StageBodySchema,
  StartBodySchema,
} from '../shared/mp/schemas.js';
import { errorResponse, jsonResponse, lobbyRoute, readBody } from './http.js';
import {
  advanceLobby,
  drawTeam,
  joinLobby,
  leaveLobby,
  lockTeams,
  powerLobby,
  readyLobby,
  rematchLobby,
  removePlayer,
  rerollTeam,
  startLobby,
  submitBuild,
} from './lobby.js';

export async function joinAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, JoinBodySchema);
  if (!parsed.ok) return parsed.response;
  const name = cleanName(parsed.value.name);
  if (!name) return errorResponse(400, 'invalid', 'Pick a name first.');
  const outcome = await joinLobby({
    code: route.code,
    name,
    secret: route.secret,
    actionId: parsed.value.actionId,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function startAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, StartBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await startLobby({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    settings: parsed.value.settings,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function drawAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, ActionBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await drawTeam({ code: route.code, secret: route.secret, actionId: parsed.value.actionId });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function rerollAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, ActionBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await rerollTeam({ code: route.code, secret: route.secret, actionId: parsed.value.actionId });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function lockAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, ActionBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await lockTeams({ code: route.code, secret: route.secret, actionId: parsed.value.actionId });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function buildAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, BuildBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await submitBuild({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    build: parsed.value.build,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function readyAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, StageBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await readyLobby({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    stage: parsed.value.stage,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function advanceAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, StageBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await advanceLobby({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    stage: parsed.value.stage,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function rematchAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, ActionBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await rematchLobby({ code: route.code, secret: route.secret, actionId: parsed.value.actionId });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function powerAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, PowerBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await powerLobby({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    power: parsed.value.power,
    target: parsed.value.target,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function removeAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, RemoveBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await removePlayer({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    seat: parsed.value.seat,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export async function leaveAction(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, ActionBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await leaveLobby({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ left: true });
}

export const ACTION_HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
  join: joinAction,
  start: startAction,
  draw: drawAction,
  reroll: rerollAction,
  lock: lockAction,
  build: buildAction,
  ready: readyAction,
  advance: advanceAction,
  rematch: rematchAction,
  power: powerAction,
  remove: removeAction,
  leave: leaveAction,
};
