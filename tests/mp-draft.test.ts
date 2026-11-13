import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import type { Pick } from '../src/shared/engine/types';
import { BuildDraftSchema } from '../src/shared/mp/schemas';
import type { BuildDraft } from '../src/shared/mp/types';

function pick(attr: string): Pick {
  return { attr, val: 90, playerName: 'Michael Jordan', playerShort: 'MJ', team: 'CHI' };
}

function draft(picks: Record<string, Pick>, overrides: Partial<BuildDraft> = {}): BuildDraft {
  return {
    position: 'guard',
    era: 'current',
    picks,
    spinIndex: Object.keys(picks).length,
    teamRespinUsed: false,
    playerRespinUsed: false,
    current: null,
    team: 'OKC',
    latest: null,
    ...overrides,
  };
}

describe('draft sync schema', () => {
  it('caps a build at ten picks', () => {
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`trait${index}`, pick(`trait${index}`)]));
    const eleven = { ...ten, trait10: pick('trait10') };
    expect(v.safeParse(BuildDraftSchema, draft(ten)).success).toBe(true);
    expect(v.safeParse(BuildDraftSchema, draft(eleven)).success).toBe(false);
  });

  it('bounds every string a peer can be shown', () => {
    expect(v.safeParse(BuildDraftSchema, draft({ jumpShot: pick('jumpShot') })).success).toBe(true);
    expect(v.safeParse(BuildDraftSchema, draft({ jumpShot: { ...pick('jumpShot'), playerName: 'x'.repeat(200) } })).success).toBe(
      false,
    );
    expect(v.safeParse(BuildDraftSchema, draft({}, { latest: { attr: 'jumpShot', playerName: 'y'.repeat(200) } })).success).toBe(
      false,
    );
    expect(v.safeParse(BuildDraftSchema, draft({}, { current: { team: 'OKC', playerName: 'z'.repeat(200) } })).success).toBe(
      false,
    );
    expect(v.safeParse(BuildDraftSchema, draft({}, { team: 'w'.repeat(40) })).success).toBe(false);
    expect(v.safeParse(BuildDraftSchema, draft({ ['k'.repeat(60)]: pick('k'.repeat(60)) })).success).toBe(false);
  });
});
