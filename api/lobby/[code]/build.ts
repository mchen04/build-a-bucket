import { DraftBodySchema } from '../../../src/shared/mp/schemas';
import { errorResponse, jsonResponse, lobbyRoute, methodNotAllowed, readBody } from '../../../src/server/http';
import { syncDraft } from '../../../src/server/lobby';

export async function POST(request: Request): Promise<Response> {
  const route = lobbyRoute(request);
  if (!route.ok) return route.response;
  const parsed = await readBody(request, DraftBodySchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await syncDraft({
    code: route.code,
    secret: route.secret,
    actionId: parsed.value.actionId,
    draft: parsed.value.draft,
  });
  if (!outcome.ok) return errorResponse(outcome.status, outcome.error.reason, outcome.error.error);
  return jsonResponse({ lobby: outcome.view });
}

export const GET = () => methodNotAllowed('POST');
