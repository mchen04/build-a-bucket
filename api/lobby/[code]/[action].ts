import { ACTION_HANDLERS } from '../../../src/server/actions.js';
import { errorResponse, methodNotAllowed } from '../../../src/server/http.js';

export async function POST(request: Request): Promise<Response> {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const action = segments[3] ?? '';
  const handler = ACTION_HANDLERS[action];
  if (!handler) return errorResponse(404, 'not_found', 'No lobby action found for that path.');
  return handler(request);
}

export const GET = () => methodNotAllowed('POST');
