export const GRADES_KEY = 'bap-hide-grades';

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
