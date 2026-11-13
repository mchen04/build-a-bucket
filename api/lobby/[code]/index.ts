import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, noContent } from '../../../src/server/http.js';
import { readLobby } from '../../../src/server/lobby.js';

export async function GET(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  let since = 0;
  try {
    const value = new URL(request.url).searchParams.get('since');
    since = value === null ? 0 : Number(value);
  } catch {
    since = 0;
  }
  if (!Number.isFinite(since) || since < 0) return errorResponse(400, 'invalid', 'since must be a positive number.');
  const outcome = await readLobby({ code: route.code, secret: route.secret });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  if (since > 0 && outcome.view.version <= since) return noContent();
  return jsonResponse({ lobby: outcome.view });
}

export const POST = () => methodNotAllowed('GET');
