import { describe, expect, it } from 'vitest';
import { awayRetainedFrom } from '../src/app/screens/Lobby';
import type { ParticipantView } from '../src/shared/mp/types';

function participant(overrides: Partial<ParticipantView>): ParticipantView {
  return {
    id: 'p',
    seat: 1,
    name: 'P',
    status: 'joined',
    isHost: false,
    isMe: false,
    away: false,
    ready: false,
    ...overrides,
  } as ParticipantView;
}

describe('lobby rematch selectors', () => {
  it('keeps away non-me participants for the host remove controls', () => {
    const participants = [participant({ seat: 1, isMe: true, isHost: true }), participant({ seat: 2, away: true }), participant({ seat: 3, status: 'left', away: true })];
    expect(awayRetainedFrom(participants).map((entry) => entry.seat)).toEqual([2]);
  });
});
