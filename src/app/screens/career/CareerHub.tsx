import { useState } from 'preact/hooks';
import type { Career, FeedItem, Offer, Round } from '../../../shared/engine/career/core';
import { legacyTier } from '../../../shared/engine/career/core';
import { ASKS, canRetire, careerTotals, hofProgress, legacyOf, marketValue, retireReason } from '../../../shared/engine/career/engine';
import { gradeFor } from '../../../shared/engine/rules';
import { TopBar } from '../../components';
import { TimingGame } from './TimingGame';

export interface CareerActions {
  advance: () => void;
  moment: (score: number) => void;
  injury: (play: boolean) => void;
  round: (hit: boolean | null) => void;
  tipOff: () => void;
  offStep: (step: string) => void;
  sign: (offer: Offer) => void;
  talks: (offer: Offer) => void;
  ask: (kind: keyof typeof ASKS) => void;
  acceptTalks: () => void;
  closeTalks: () => void;
  spend: (trait: string) => void;
  bodyWork: () => void;
  camp: (score: number) => void;
  nextSeason: () => void;
  retire: () => void;
}

interface Props {
  career: Career;
  actions: CareerActions;
  onExit: () => void;
}

type Tab = 'season' | 'player' | 'career';

function FeedRow({ item }: { item: FeedItem }) {
  if (item.kind === 'games') {
    return (
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <span class="tiny">{item.headline ?? `Games ${item.k}`}</span>
        <span class="tiny muted">{item.lines.slice(-2).join(' · ')}</span>
      </div>
    );
  }
  if (item.kind === 'note' || item.kind === 'injury' || item.kind === 'award') return <div class="tiny muted">{item.text}</div>;
  return (
    <div class="tiny">
      {item.title}: {item.detail}
    </div>
  );
}

function RoundRow({ round }: { round: Round }) {
  return (
    <div class="row" style={{ justifyContent: 'space-between' }}>
      <span class="tiny">
        {round.name} · {round.opp}
      </span>
      <span class="tiny muted">
        {round.played ? `${round.won ? 'Won' : 'Lost'} ${round.mySc}-${round.oppSc}${round.series ? ' (series)' : ''}` : `${Math.round(round.p * 100)}%`}
      </span>
    </div>
  );
}

export function CareerHub({ career, actions, onExit }: Props) {
  const [tab, setTab] = useState<Tab>('season');
  const [campPlayed, setCampPlayed] = useState(false);
  const active = career.active;
  const totals = careerTotals(career);
  const legacy = legacyOf(career);

  const campCard = () =>
    career.off?.camp ? (
      <div class="card" data-testid="career-camp">
        <div class="tiny muted">TRAINING CAMP</div>
        <div class="title" style={{ marginTop: '2px' }}>
          {career.off.camp.won ? 'Won the drill' : 'A rough camp'}
        </div>
        <div class="tiny muted">
          {Math.round((career.off.camp.score ?? 0) * 100)}% · {career.off.camp.bonus ? '+1 development point' : 'no extra point'} · +
          {career.off.camp.legacy} legacy
        </div>
      </div>
    ) : career.games === 'simple' && !campPlayed ? (
      <TimingGame
        title="Training camp drill"
        traitValue={career.build[Object.keys(career.build)[0] as string]?.val ?? 5}
        onDone={(score) => {
          setCampPlayed(true);
          actions.camp(score);
        }}
      />
    ) : (
      <div class="card" data-testid="career-camp-card">
        <div class="tiny muted">TRAINING CAMP</div>
        <div class="notice">One hard drill before the season: legacy and a shot at a development point.</div>
        <button
          class="btn btn-small"
          data-testid="career-camp-run"
          onClick={() => {
            setCampPlayed(true);
            actions.camp(0.55);
          }}
        >
          Run the drill
        </button>
      </div>
    );

  const seasonTab = () => {
    if (phase === 'preseason') return preseasonTab();
    if (phase === 'season' && active) return seasonBody();
    if (phase === 'offseason') return offseasonTab();
    if (phase === 'retired') return retiredTab();
    return null;
  };

  const phase = career.phase;

  function preseasonTab() {
    const goals = career.goals.length ? career.goals : [];
    return (
      <>
        <div class="card" data-testid="career-preseason">
          <div class="tiny muted">THE SEASON AHEAD</div>
          <div class="title" style={{ marginTop: '2px' }}>
            Year {career.year + 1} · {career.fit?.name}
          </div>
          <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
            {career.fit?.off} OFF · {career.fit?.def} DEF · {career.role}
          </div>
        </div>
        <div class="card">
          <div class="tiny muted">GOALS</div>
          {goals.map((goal) => (
            <div class="tiny" key={goal.k}>
              {goal.label}
            </div>
          ))}
        </div>
        {career.aging?.length ? (
          <div class="card">
            <div class="tiny muted">THE SUMMER</div>
            {career.aging.slice(0, 6).map((note, index) => (
              <div class="tiny" key={index}>
                {note}
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
  }

  function seasonBody() {
    if (!active) return null;
    if (active.moment) {
      return (
        <TimingGame title={`${active.moment.title} · the moment`} traitValue={active.moment.trait} onDone={(score) => actions.moment(score)} />
      );
    }
    if (active.injury) {
      return (
        <div class="card" data-testid="career-injury">
          <div class="tiny muted">INJURY</div>
          <div class="title" style={{ marginTop: '2px' }}>
            {active.injury.kind}
          </div>
          <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
            {active.injury.games} games out if he sits{active.injury.serious ? ' · the season' : ''}.
          </div>
          <div class="row" style={{ marginTop: '6px' }}>
            <button class="btn btn-small" data-testid="career-play-through" onClick={() => actions.injury(true)}>
              Play through it
            </button>
            <button class="btn btn-ghost btn-small" data-testid="career-sit" onClick={() => actions.injury(false)}>
              Sit out
            </button>
          </div>
        </div>
      );
    }
    if (active.po) {
      const round = active.po.rounds[active.po.idx];
      return (
        <>
          <div class="card" data-testid="career-bracket">
            <div class="tiny muted">PLAYOFFS · SEED {active.final?.seed}</div>
            {active.po.rounds.map((entry, index) => (
              <RoundRow key={index} round={entry} />
            ))}
          </div>
          <div class="notice">
            {round
              ? `${round.name} vs ${round.oppName}${round.home == null ? '' : round.home ? ' · at home' : ' · on the road'}`
              : 'The run is over.'}
          </div>
        </>
      );
    }
    const last = active.feed.slice(-4).reverse();
    return (
      <>
        <div class="card" data-testid="career-season">
          <div class="tiny muted">
            YEAR {career.year + 1} · {active.k}/82 GAMES
          </div>
          <div class="title" style={{ marginTop: '2px' }}>
            {active.lines.filter((g) => g.won).length}-{active.lines.filter((g) => !g.won).length}
          </div>
          <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
            {career.role}
            {active.benched ? ` · behind ${active.benched.behind}` : ''} · {career.ovr} OVR
          </div>
          {active.streak ? <div class="tiny muted">{active.streak.label}</div> : null}
        </div>
        <div class="card">
          {last.map((item, index) => (
            <FeedRow item={item} key={index} />
          ))}
        </div>
      </>
    );
  }

  function offseasonTab() {
    const last = career.seasons[career.seasons.length - 1];
    const step = career.off?.step ?? 'recap';
    if (step === 'contract') {
      const talks = career.talks;
      if (talks) {
        return (
          <div class="card" data-testid="career-talks">
            <div class="tiny muted">TALKS · {talks.fit.name}</div>
            <div class="title" style={{ marginTop: '2px' }}>
              {talks.years} yrs · ${talks.perYear}M
            </div>
            {talks.lines.map((line, index) => (
              <div class="tiny muted" key={index}>
                {line}
              </div>
            ))}
            {!talks.walked ? (
              <>
                <div class="row" style={{ marginTop: '6px', flexWrap: 'wrap' }}>
                  {(Object.keys(ASKS) as (keyof typeof ASKS)[]).map((kind) => (
                    <button class="btn btn-ghost btn-small" key={kind} onClick={() => actions.ask(kind)}>
                      {ASKS[kind].label}
                    </button>
                  ))}
                </div>
                <button class="btn btn-small" data-testid="career-accept" style={{ marginTop: '6px' }} onClick={actions.acceptTalks}>
                  Sign it
                </button>
              </>
            ) : null}
            <button class="btn btn-ghost btn-small" style={{ marginTop: '6px' }} onClick={actions.closeTalks}>
              Back to the offers
            </button>
          </div>
        );
      }
      return (
        <div class="card" data-testid="career-contract">
          <div class="tiny muted">FREE AGENCY</div>
          {(career.offers ?? []).map((offer) => (
            <div class="home-item" key={offer.kind} data-testid={`career-offer-${offer.kind}`}>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span class="name">
                  {offer.fit.name} · {offer.years} yrs · ${offer.perYear}M
                </span>
                <span class="sub">{offer.pitch}</span>
              </span>
              <span class="row">
                <button class="icon-btn wide" onClick={() => actions.sign(offer)}>
                  Sign
                </button>
                <button class="icon-btn wide" onClick={() => actions.talks(offer)}>
                  Talk
                </button>
              </span>
            </div>
          ))}
          {!(career.offers ?? []).length ? <div class="notice">Nobody called. That is the end of the road.</div> : null}
        </div>
      );
    }
    return (
      <>
        {last ? (
          <div class="card" data-testid="career-recap">
            <div class="tiny muted">
              YEAR {last.season} · {last.teamName}
            </div>
            <div class="title" style={{ marginTop: '2px' }}>
              {last.wins}-{last.losses}
              {last.champion ? ' · CHAMPIONS' : last.playoffs ? ' · PLAYOFFS' : ''}
            </div>
            <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
              {last.stats.ppg} PPG · {last.stats.rpg} RPG · {last.stats.apg} APG · {last.stats.gp} games
            </div>
            <div class="tiny" style={{ marginTop: '4px' }}>
              {[
                last.award ? 'MVP' : null,
                last.allPro ? 'ALL-NBA' : null,
                last.proBowl ? 'ALL-STAR' : null,
                last.roy ? 'ROOKIE OF THE YEAR' : null,
                last.fmvp ? 'FINALS MVP' : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No honours this year'}
            </div>
            <div class="tiny muted" style={{ marginTop: '4px' }}>
              {last.goals.map((goal) => `${goal.met ? '✓' : '·'} ${goal.label}`).join('   ')}
            </div>
          </div>
        ) : null}
        {campCard()}
        <div class="card">
          <div class="tiny muted">TEAM NEWS</div>
          {(career.off?.moves ?? []).slice(0, 4).map((move, index) => (
            <div class="tiny" key={index}>
              {move}
            </div>
          ))}
          {(career.off?.news ?? []).map((item, index) => (
            <div class="tiny muted" key={`n${index}`}>
              {item}
            </div>
          ))}
        </div>
      </>
    );
  }

  function seasonButton() {
    if (phase === 'preseason') {
      return (
        <button class="btn" data-testid="career-tipoff" onClick={actions.tipOff}>
          Tip off the season
        </button>
      );
    }
    if (phase === 'season' && active) {
      if (active.moment || active.injury) {
        return (
          <button class="btn" disabled>
            {active.moment ? 'Make the play' : 'Deal with the injury'}
          </button>
        );
      }
      if (active.po) {
        const round = active.po.rounds[active.po.idx];
        return (
          <button class="btn" data-testid="career-round" onClick={() => actions.round(null)}>
            {round ? `Play ${round.name.toLowerCase()}` : 'Finish'}
          </button>
        );
      }
      return (
        <button class="btn" data-testid="career-advance" onClick={actions.advance}>
          {active.k >= 82 ? 'Finish the regular season' : `Play 10 games (${active.k}/82)`}
        </button>
      );
    }
    if (phase === 'offseason') {
      if (career.contract && career.contract.left > 0) {
        return (
          <button class="btn" data-testid="career-off-next" onClick={actions.nextSeason}>
            On to {career.season + 1}
          </button>
        );
      }
      if ((career.offers?.length ?? 0) > 0) {
        return (
          <button class="btn" data-testid="career-off-sign" onClick={() => actions.offStep('contract')}>
            Choose a deal
          </button>
        );
      }
      return (
        <button class="btn" data-testid="career-off-retire" onClick={actions.retire}>
          Nobody called: retire
        </button>
      );
    }
    return null;
  }

  const playerTab = () => (
    <>
      <div class="card">
        <div class="tiny muted">BUILD · {career.ovr} OVR</div>
        <div class="cr-traits">
          {Object.entries(career.build).map(([trait, value]) => (
            <div class="cr-trait" key={trait}>
              <span class="tiny muted">{trait}</span>
              <b>{gradeFor(value.val)}</b>
              {career.phase !== 'season' && career.dev.points > 0 ? (
                <button class="icon-btn" data-testid={`career-spend-${trait}`} onClick={() => actions.spend(trait)}>
                  +
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div class="card" data-testid="career-player">
        <div class="tiny muted">BODY</div>
        <div class="tiny">
          Durability {career.durability} · rep {career.rep}
        </div>
        {career.phase !== 'season' && career.dev.points > 0 ? (
          <button class="btn btn-ghost btn-small" onClick={actions.bodyWork} data-testid="career-bodywork">
            Body work (1-2 points)
          </button>
        ) : null}
      </div>
      <div class="card">
        <div class="tiny muted">CONTRACT</div>
        <div class="tiny">
          {career.contract
            ? `${career.contract.kind} · ${career.contract.years} yrs · $${career.contract.perYear}M · ${career.contract.left} left`
            : 'None'}
        </div>
        <div class="tiny muted">
          Market: ${marketValue(career)}M · {career.dev.points} development {career.dev.points === 1 ? 'point' : 'points'}
        </div>
      </div>
      {career.injuries.length ? (
        <div class="card">
          <div class="tiny muted">INJURY HISTORY</div>
          {career.injuries.slice(-5).map((injury, index) => (
            <div class="tiny" key={index}>
              Year {injury.year}: {injury.kind} ({injury.games} games{injury.played ? ', played through' : ''})
            </div>
          ))}
        </div>
      ) : null}
    </>
  );

  const careerTab = () => (
    <>
      <div class="card" data-testid="career-totals">
        <div class="tiny muted">CAREER</div>
        <div class="row" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <span class="tiny">
            <b>{totals.seasons}</b> seasons
          </span>
          <span class="tiny">
            <b>{totals.wins + totals.losses}</b> games
          </span>
          <span class="tiny">
            <b>{totals.rings}</b> rings
          </span>
          <span class="tiny">
            <b>{totals.awards}</b> MVP
          </span>
          <span class="tiny">
            <b>{totals.allPros}</b> All-NBA
          </span>
          <span class="tiny">
            <b>{totals.proBowls}</b> All-Star
          </span>
        </div>
        <div class="tiny muted" style={{ marginTop: '4px' }}>
          {totals.stats.ppg ?? 0} PPG · {totals.stats.rpg ?? 0} RPG · {totals.stats.apg ?? 0} APG · {totals.stats.pts ?? 0} points
        </div>
      </div>
      <div class="card" data-testid="career-legacy">
        <div class="tiny muted">LEGACY</div>
        <div class="title" style={{ marginTop: '2px' }}>
          {legacy.score} · {legacy.tier}
        </div>
        <div class="tiny muted">Hall of Fame progress: {hofProgress(career)}%</div>
      </div>
      <div class="card">
        <div class="tiny muted">DECISIONS</div>
        {career.decisions.slice(-6).map((decision, index) => (
          <div class="tiny" key={index}>
            Year {decision.year}: {decision.text}
          </div>
        ))}
      </div>
    </>
  );

  const retiredTab = () => (
    <>
      <div class="card" data-testid="career-retired">
        <div class="tiny muted">RETIRED</div>
        <div class="title" style={{ marginTop: '2px' }}>
          {career.name} · {career.age}
        </div>
        <div class="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
          {totals.seasons} seasons · {totals.rings} rings · {totals.awards} MVP · {totals.proBowls} All-Star
        </div>
        <div class="tiny muted" style={{ marginTop: '4px' }}>
          Legacy {legacy.score} · {legacyTier(legacy.score)}
        </div>
      </div>
      <div class="card" data-testid="career-hof">
        <div class="tiny muted">HALL OF FAME</div>
        <div class="title" style={{ marginTop: '2px' }}>
          {career.hof?.in ? 'INDUCTED' : 'NOT INDUCTED'}
        </div>
        <div class="tiny muted">
          {career.hof?.pct}% of the vote · {career.hof?.ballot}
        </div>
      </div>
      <div class="card">
        <div class="notice">The Pro-only comeback (three more seasons) is not available in this rebuild: retired is retired.</div>
      </div>
    </>
  );

  if (phase === 'retired') {
    return (
      <div class="screen">
        <TopBar title={`${career.name} · retired`} onBack={onExit} />
        <div class="body">
          {retiredTab()}
          {careerTab()}
        </div>
        <div class="bottom">
          <button class="btn" onClick={onExit}>
            Back to the slots
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      <TopBar
        title={`${career.name} · ${career.fit?.short ?? 'Free agent'}`}
        onBack={onExit}
        right={<span class="tiny muted">{career.ovr} OVR</span>}
      />
      <div class="body">
        <div class="seg cr-tabs">
          {(['season', 'player', 'career'] as Tab[]).map((id) => (
            <button key={id} aria-pressed={tab === id} data-testid={`career-tab-${id}`} onClick={() => setTab(id)}>
              {id === 'season' ? (phase === 'offseason' ? 'OFFSEASON' : 'SEASON') : id.toUpperCase()}
            </button>
          ))}
        </div>
        {tab === 'season' ? seasonTab() : null}
        {tab === 'player' ? playerTab() : null}
        {tab === 'career' ? (
          <>
            {careerTab()}
            {retireReason(career) && phase === 'offseason' ? <div class="notice">The body has had enough.</div> : null}
          </>
        ) : null}
      </div>
      <div class="bottom">
        {tab === 'season' ? (
          seasonButton()
        ) : (
          <div class="row">
            {canRetire(career) ? (
              <button class="btn" data-testid="career-retire" onClick={actions.retire}>
                Retire
              </button>
            ) : null}
            <button class="btn btn-ghost" onClick={onExit}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
