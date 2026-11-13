export interface MpSession {
  v: 1;
  code: string;
  secret: string;
  name: string;
}

const KEY = 'bab:mp:v1';

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
