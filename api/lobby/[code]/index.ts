import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, noContent } from '../../../src/server/http.js';
import { buildLobbyDelta, readLobby, unchangedPoll } from '../../../src/server/lobby.js';
import { progressToken } from '../../../src/shared/mp/progress.js';

export async function GET(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const params = new URL(request.url).searchParams;
  const since = Number(params.get('since') ?? 0);
  const events = Number(params.get('events') ?? 0);
  const token = params.get('token');
  const waiting = params.get('waiting') === '1';
  if (!Number.isFinite(since) || since < 0 || !Number.isFinite(events) || events < 0) {
    return errorResponse(400, 'invalid', 'since and events must be positive numbers.');
  }
  if (waiting) {
    const decision = await unchangedPoll({ code: route.code, secret: route.secret, since, token });
    if (decision === 'no_content') return noContent();
    if (decision === 'not_found') return errorResponse(404, 'not_found', 'No lobby found for that code.');
    if (decision === 'forbidden') return errorResponse(403, 'forbidden', 'You are not in this lobby.');
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
