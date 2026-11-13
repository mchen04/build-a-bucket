import { RemoveBodySchema } from '../../../src/shared/mp/schemas.js';
import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, readBody } from '../../../src/server/http.js';
import { removePlayer } from '../../../src/server/lobby.js';

export async function POST(request: Request): Promise<Response> {
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

export const GET = () => methodNotAllowed('POST');
