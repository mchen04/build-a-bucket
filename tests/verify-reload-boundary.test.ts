import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordNoBoundary } from '../.claude/skills/verify-build-a-bucket/scripts/reload-boundary.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('no-boundary reload evidence', () => {
  it('writes before and none captures, never after', async () => {
    const ev = mkdtempSync(path.join(os.tmpdir(), 'reload-boundary-'));
    temps.push(ev);
    const phases: string[] = [];
    const snapReload = async (seat: { seat: number; name: string }, phase: string) => {
      phases.push(`${seat.seat}:${phase}`);
    };
    const reload: Record<string, unknown> = {};
    const proof = { classification: 'no-held-boundary', reason: 'no held playoff gate', attempts: [] };
    await recordNoBoundary({ seat: { seat: 2, name: 'Ben' }, other: { seat: 1, name: 'Ava' }, snapReload, proof, ev, reload });
    expect(phases).toEqual(['2:before', '1:before', '2:none', '1:none']);
    expect(phases.some((phase) => phase.endsWith(':after'))).toBe(false);
    expect(reload.classification).toBe('no-held-boundary');
    expect(reload.ran).toBe(false);
    expect(reload.attempts).toBe('reload-attempts.json');
    const attempts = JSON.parse(readFileSync(path.join(ev, 'reload-attempts.json'), 'utf8'));
    expect(attempts.classification).toBe('no-held-boundary');
    expect(attempts.samples).toEqual([]);
  });

  it('writes only the refreshed seat when there is no other seat', async () => {
    const ev = mkdtempSync(path.join(os.tmpdir(), 'reload-boundary-'));
    temps.push(ev);
    const phases: string[] = [];
    const snapReload = async (seat: { seat: number; name: string }, phase: string) => {
      phases.push(`${seat.seat}:${phase}`);
    };
    const reload: Record<string, unknown> = {};
    await recordNoBoundary({ seat: { seat: 2, name: 'Ben' }, other: null, snapReload, proof: { classification: 'no-held-boundary', reason: 'no held playoff gate', attempts: [] }, ev, reload });
    expect(phases).toEqual(['2:before', '2:none']);
  });
});
