import { cleanName } from '../../../src/shared/mp/codes.js';
import { JoinBodySchema } from '../../../src/shared/mp/schemas.js';
import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, readBody } from '../../../src/server/http.js';
import { joinLobby } from '../../../src/server/lobby.js';

export async function POST(request: Request): Promise<Response> {
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

export const GET = () => methodNotAllowed('POST');
