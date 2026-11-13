import type { LobbyPhase, ParticipantView } from '../../shared/mp/types';
import { shortStatus, statusLine } from '../mp/format';

interface Props {
  participants: ParticipantView[];
  phase: LobbyPhase;
  capacity: number;
  compact?: boolean;
  myProgress?: number;
}

export function Roster(props: Props) {
  const labelFor = (entry: ParticipantView): string => {
    if (entry.isMe && props.myProgress !== undefined && props.myProgress > (entry.summary?.filled ?? 0)) {
      return `${props.myProgress}/10`;
    }
    return shortStatus(entry, props.phase);
  };

  if (props.compact) {
    return (
      <div class="roster-grid" data-testid="peer-strip">
        {props.participants.map((entry) => (
          <div
            class={`peer${entry.isMe ? ' me' : ''}${entry.status === 'left' ? ' gone' : ''}${
              entry.season?.champion ? ' champ' : ''
            }`}
            key={entry.seat}
            data-seat={entry.seat}
            data-status={entry.status}
            title={`${entry.name}: ${statusLine(entry, props.phase)}`}
          >
            <span class="peer-seat">{entry.seat}</span>
            <span class="peer-name">{entry.name}</span>
            <span class="peer-state">{labelFor(entry)}</span>
          </div>
        ))}
      </div>
    );
  }

  const openSeats = Math.max(0, props.capacity - props.participants.length);
  return (
    <div class="roster" data-testid="roster">
      {props.participants.map((entry) => (
        <div
          class={`roster-row${entry.isMe ? ' me' : ''}${entry.status === 'left' ? ' gone' : ''}`}
          key={entry.seat}
          data-seat={entry.seat}
          data-status={entry.status}
        >
          <span class="seat">{entry.seat}</span>
          <span class="who">
            {entry.name}
            {entry.isHost ? <span class="roster-tag">HOST</span> : null}
            {entry.away && entry.status !== 'left' ? <span class="roster-tag away">AWAY</span> : null}
          </span>
          <span class={`state${entry.season?.champion ? ' champ' : ''}`}>{statusLine(entry, props.phase)}</span>
        </div>
      ))}
      {Array.from({ length: openSeats }, (_, index) => (
        <div class="roster-row empty" key={`open-${index}`}>
          <span class="seat">+</span>
          <span class="who muted">open seat</span>
        </div>
      ))}
    </div>
  );
}
