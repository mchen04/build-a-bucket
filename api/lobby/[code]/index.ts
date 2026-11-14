import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, noContent } from '../../../src/server/http.js';
import { buildLobbyDelta, pollLobby, readLobby } from '../../../src/server/lobby.js';
import { progressToken } from '../../../src/shared/mp/progress.js';

export async function GET(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const params = new URL(request.url).searchParams;
  const since = Number(params.get('since') ?? 0);
  const events = Number(params.get('events') ?? 0);
  const token = params.get('token');
  const waiting = params.get('waiting') === '1';
  const cursorParam = params.get('cursor');
  const stageParam = params.get('stage');
  const cursor = cursorParam === null ? null : Number(cursorParam);
  const stage = stageParam === null ? null : Number(stageParam);
  if (!Number.isFinite(since) || since < 0 || !Number.isFinite(events) || events < 0) {
    return errorResponse(400, 'invalid', 'since and events must be positive numbers.');
  }
  if ((cursor !== null && (!Number.isFinite(cursor) || cursor < 0)) || (stage !== null && (!Number.isFinite(stage) || stage < 0))) {
    return errorResponse(400, 'invalid', 'cursor and stage must be positive numbers.');
  }
  if (since > 0) {
    const outcome = await pollLobby({ code: route.code, secret: route.secret, since, events, token, cursor, stage }, waiting);
    if (outcome.kind === 'no_content') return noContent();
    if (outcome.kind === 'not_found') return errorResponse(404, 'not_found', 'No lobby found for that code.');
    if (outcome.kind === 'forbidden') return errorResponse(403, 'forbidden', 'You are not in this lobby.');
    if (outcome.kind === 'clock') return jsonResponse({ lobby: outcome.view });
    if (outcome.kind === 'league_delta') return jsonResponse({ delta: outcome.delta });
  }
  const outcome = await readLobby({ code: route.code, secret: route.secret, sinceEvent: events });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  const view = outcome.view;
  if (since > 0 && view.version <= since) {
    if (token === null || token === progressToken(view)) return noContent();
    return jsonResponse({ delta: buildLobbyDelta(view, events) });
  }
  return jsonResponse({ lobby: view });
}

export const POST = () => methodNotAllowed('GET');
