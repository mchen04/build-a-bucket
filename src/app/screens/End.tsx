import { archetypeFor } from '../../shared/engine/archetype';
import { computeOvr } from '../../shared/engine/ovr';
import { seasonHeadline } from '../../shared/engine/season';
import type { RunState } from '../../shared/run';
import { StatGrid, TopBar } from '../components';

interface Props {
  run: RunState;
  onNewBuild: () => void;
}

export function End(props: Props) {
  const season = props.run.season;
  if (!season) return null;
  const ovr = season.ovr || computeOvr(props.run.picks, props.run.position);
  const archetype = season.archetype || archetypeFor(ovr, props.run.picks, props.run.position);
  const headline = seasonHeadline(season);
  const ribbons = [season.champion && 'NBA CHAMPS', season.mvp && 'MVP', season.dpoy && 'DPOY'].filter(
    (entry): entry is string => typeof entry === 'string',
  );
  return (
    <div class="screen">
      <TopBar title="Final Report" right={<span class="tiny muted">{season.team}</span>} />
      <div class="body">
        <div class={`banner ${season.champion ? '' : 'miss'}`} data-testid="outcome">
          <h1>{headline}</h1>
          <p>
            {season.wins}-{season.losses} · Seed #{season.seed}
            {season.finalsOpp ? ` · Finals vs ${season.finalsOpp} (${season.finalsSeries})` : ''}
          </p>
          {ribbons.length ? (
            <p class="tiny">{[...ribbons, `${props.run.era === 'alltime' ? 'ALL-TIME' : 'CURRENT'} · ${props.run.position.toUpperCase()}`].join(' · ')}</p>
          ) : null}
        </div>
        <div class="row" style={{ alignItems: 'center' }}>
          <div>
            <div class="tiny muted">OVR</div>
            <div style={{ fontSize: '24px', fontWeight: 900 }} data-testid="ovr">
              {ovr}
            </div>
          </div>
          <div style={{ flex: 2, textAlign: 'right' }}>
            <div class="tiny muted">Archetype</div>
            <div style={{ fontSize: '13px', fontWeight: 800 }} data-testid="archetype">
              {archetype}
            </div>
          </div>
        </div>
        <StatGrid
          items={[
            { label: 'PPG', value: season.ppg.toFixed(1) },
            { label: 'RPG', value: season.rpg.toFixed(1) },
            { label: 'APG', value: season.apg.toFixed(1) },
            { label: 'PER', value: season.per.toFixed(1) },
          ]}
        />
        <StatGrid
          items={[
            { label: 'SPG', value: season.spg.toFixed(1) },
            { label: 'BPG', value: season.bpg.toFixed(1) },
            { label: 'FG%', value: season.fgPct },
            { label: '3P%', value: season.threePct },
          ]}
        />
        <div class="award">
          <span class="tag">MVP</span>
          <span class="who">{season.displayMvp.name}</span>
          <span class="num">{season.displayMvp.isPlayer ? 'YOU' : season.displayMvp.team}</span>
        </div>
        <div class="award">
          <span class="tag">DPOY</span>
          <span class="who">{season.displayDpoy.name}</span>
          <span class="num">{season.displayDpoy.isPlayer ? 'YOU' : season.displayDpoy.team}</span>
        </div>
        <div class="award">
          <span class="tag">GOAT</span>
          <span class="who">{season.goatRank ? `#${season.goatRank} all-time` : 'Not ranked'}</span>
          <span class="num">{season.goatRank ? 'Top 75' : 'OVR below 92'}</span>
        </div>
      </div>
      <div class="bottom">
        <button class="btn" onClick={props.onNewBuild}>
          New Build
        </button>
      </div>
    </div>
  );
}
