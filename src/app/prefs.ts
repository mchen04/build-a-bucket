export const GRADES_KEY = 'bap-hide-grades';
export const MOMENTS_KEY = 'bap_moments_off';
export const RECENT_KEY = 'bap_scn_recent';

export function readGradesHidden(): boolean {
  try {
    return localStorage.getItem(GRADES_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeGradesHidden(hidden: boolean): void {
  try {
    localStorage.setItem(GRADES_KEY, String(hidden));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('bap:grades', { detail: hidden }));
}

export function readMomentsOff(): boolean {
  try {
    return localStorage.getItem(MOMENTS_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMomentsOff(off: boolean): void {
  try {
    localStorage.setItem(MOMENTS_KEY, off ? '1' : '0');
  } catch {
    return;
  }
}

export function recentMoments(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberMoment(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentMoments().filter((entry) => entry !== id)].slice(0, 30)));
  } catch {
    return;
  }
}
