import { ReleaseBodySchema } from '../../../src/shared/mp/schemas.js';
import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, readBody } from '../../../src/server/http.js';
import { releasePlayoffs } from '../../../src/server/lobby.js';

export async function POST(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, ReleaseBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await releasePlayoffs({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    force: parsed.value.force,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export const GET = () => methodNotAllowed('POST');
