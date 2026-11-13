import { cleanName } from '../../src/shared/mp/codes.js';
import { CreateBodySchema } from '../../src/shared/mp/schemas.js';
import type { LobbySettings } from '../../src/shared/mp/types.js';
import { errorResponse, jsonResponse, methodNotAllowed, readBody, secretFromRequest } from '../../src/server/http.js';
import { createLobby } from '../../src/server/lobby.js';

const DEFAULT_SETTINGS: LobbySettings = { era: 'current', mode: 'normal' };

export async function POST(request: Request): Promise<Response> {
  const secret = secretFromRequest(request);
  if (!secret) return errorResponse(401, 'forbidden', 'Missing participant secret.');
  const parsed = await readBody(request, CreateBodySchema);
  if (!parsed.ok) return parsed.response;
  const name = cleanName(parsed.value.name);
  if (!name) return errorResponse(400, 'invalid', 'Pick a name first.');
  const result = await createLobby({
    name,
    secret,
    actionId: parsed.value.actionId,
    settings: parsed.value.settings ?? DEFAULT_SETTINGS,
  });
  if (!result.ok) return errorResponse(result.status, result.error.reason, result.error.error);
  return jsonResponse({ lobby: result.view, code: result.code, seat: result.seat }, 201);
}

export const GET = () => methodNotAllowed('POST');
