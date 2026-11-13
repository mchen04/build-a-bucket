import * as v from 'valibot';
import { SecretSchema } from '../../shared/mp/schemas';

export interface MpSession {
  v: 1;
  code: string;
  secret: string;
  name: string;
}

const KEY = 'bab:mp:v1';

const SessionSchema = v.object({
  v: v.literal(1),
  code: v.pipe(v.string(), v.regex(/^[A-Z2-9]{6}$/)),
  secret: SecretSchema,
  name: v.string(),
});

export function loadMpSession(storage: Storage = localStorage): MpSession | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = v.safeParse(SessionSchema, JSON.parse(raw));
    return parsed.success ? (parsed.output as unknown as MpSession) : null;
  } catch {
    return null;
  }
}

export function saveMpSession(session: MpSession, storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

export function clearMpSession(storage: Storage = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    return;
  }
}
