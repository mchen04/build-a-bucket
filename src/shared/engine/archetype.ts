import { BIG_ATTRS, GUARD_ATTRS } from './rules.js';
import type { Pick, Position } from './types.js';

type Getter = (attr: string) => number;

interface Ctx {
  get: Getter;
  spread: number;
  mean: number;
  top: (key: string) => boolean;
  top2: (key: string) => boolean;
  top3: (key: string) => boolean;
  balanced: boolean;
}

function context(picks: Record<string, Pick>, position: Position): { remaining: number; full: Ctx | null } | null {
  const types: readonly string[] = position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
  const present = types.filter((attr) => picks[attr]);
  if (present.length === 0) return null;
  const remaining = types.length - present.length;
  if (remaining > 0) return { remaining, full: null };
  const get: Getter = (attr) => picks[attr]?.val ?? 0;
  const values = present.map((attr) => picks[attr]?.val ?? 0);
  const spread = Math.max(...values) - Math.min(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const order = position === 'guard'
    ? [
        { k: 'js', v: get('jumpShot') },
        { k: 'fin', v: get('finishing') },
        { k: 'pas', v: get('passing') },
        { k: 'hnd', v: get('handles') },
        { k: 'pd', v: get('perimeterDefense') },
        { k: 'spd', v: get('speed') },
        { k: 'bnc', v: get('bounce') },
        { k: 'sz', v: get('size') },
        { k: 'iq', v: get('basketballIQ') },
        { k: 'clt', v: get('clutch') },
      ]
    : [
        { k: 'js', v: get('jumpShot') },
        { k: 'fin', v: get('finishing') },
        { k: 'pm', v: get('playmaking') },
        { k: 'id', v: get('interiorDefense') },
        { k: 'reb', v: get('rebounding') },
        { k: 'spd', v: get('speed') },
        { k: 'bnc', v: get('bounce') },
        { k: 'sz', v: get('size') },
        { k: 'iq', v: get('basketballIQ') },
        { k: 'clt', v: get('clutch') },
      ];
  order.sort((a, b) => b.v - a.v);
  const first = order[0]?.k ?? '';
  const second = order[1]?.k ?? '';
  const third = order[2]?.k ?? '';
  return {
    remaining: 0,
    full: {
      get,
      spread,
      mean,
      top: (key: string) => first === key,
      top2: (key: string) => first === key || second === key,
      top3: (key: string) => first === key || second === key || third === key,
      balanced: spread <= 1 && mean >= 8,
    },
  };
}

export function archetypeFor(ovr: number, picks: Record<string, Pick>, position: Position): string {
  const ctx = context(picks, position);
  if (!ctx) return 'Spin to start building';
  if (ctx.remaining > 0) return `${ctx.remaining} attribute${ctx.remaining === 1 ? '' : 's'} remaining`;
  if (!ctx.full) return 'Spin to start building';
  return position === 'guard' ? guardLabel(ovr, ctx.full) : bigLabel(ovr, ctx.full);
}

function guardLabel(ovr: number, ctx: Ctx): string {
  const { get, spread, top, top2, top3, balanced } = ctx;
  const js = get('jumpShot');
  const fin = get('finishing');
  const pas = get('passing');
  const hnd = get('handles');
  const pd = get('perimeterDefense');
  const spd = get('speed');
  const bnc = get('bounce');
  const iq = get('basketballIQ');
  const ten = (v: number) => v >= 10;
  const nine = (v: number) => v >= 9;
  const eight = (v: number) => v >= 8;

  if (ovr >= 95) {
    if (ten(js) && ten(hnd) && ten(spd)) return 'Untouchable Shot Creator';
    if (ten(hnd) && ten(pas) && ten(iq)) return 'The Architect';
    if (ten(fin) && ten(spd) && ten(bnc)) return 'Physical Phenomenon';
    if (ten(pd) && ten(js) && ten(hnd)) return 'Perfect Two-Way Guard';
    if (balanced) return 'Generational Superstar';
    if (top('js') || top2('js')) return 'Transcendent Scorer';
    if (top('fin') || top2('fin')) return 'Transcendent Athlete';
    if (top('pas') || top2('pas')) return 'Maestro Point Guard';
    return 'Transcendent Guard';
  }
  if (ovr >= 90) {
    if (top2('js') && top2('hnd') && pd < 7) return 'Elite Shot Creator';
    if (top2('pas') && top2('hnd') && nine(pas)) return 'Elite Playmaker';
    if (top2('fin') && top2('spd') && nine(bnc)) return 'Explosive Slasher';
    if (top2('pd') && top2('js') && nine(pd)) return 'Premier Two-Way Guard';
    if (top2('pd') && top2('hnd')) return 'Two-Way Maestro';
    if (top2('iq') && top2('pas')) return 'System Architect';
    if (top2('js') && top2('pas')) return 'Pass-and-Score Point';
    if (top2('bnc') && top2('fin') && nine(spd)) return 'High-Flying Superstar';
    if (top2('js') && top2('pd')) return 'Elite 3-and-D';
    if (balanced) return 'Franchise Lead Guard';
    if (top('js')) return 'Elite Scorer';
    if (top('fin')) return 'Elite Slasher';
    if (top('hnd')) return 'Elite Ballhandler';
    if (top('pas')) return 'Elite Floor General';
    if (top('pd')) return 'Elite Perimeter Defender';
    if (top('spd')) return 'Elite Downhill Attacker';
    return 'Superstar';
  }
  if (ovr >= 84) {
    if (top2('js') && top2('hnd') && pd < 7) return 'Scoring Shot Creator';
    if (top2('js') && top2('pd') && eight(js)) return '3-and-D Wing';
    if (top2('pas') && top2('iq') && nine(pas)) return 'Pure Point Guard';
    if (top2('fin') && top2('spd') && eight(bnc)) return 'Drive-First Slasher';
    if (top2('bnc') && top2('fin') && eight(spd)) return 'High-Flying Finisher';
    if (top2('hnd') && top2('fin') && eight(hnd)) return 'Combo Guard Slasher';
    if (top2('pd') && top2('spd') && nine(pd)) return 'Point-of-Attack Stopper';
    if (top2('js') && top2('pas')) return 'Playshot Guard';
    if (top2('iq') && top3('clt') && eight(iq)) return 'Clutch IQ Player';
    if (top2('spd') && top2('bnc') && pd < 6) return 'Freak Athlete';
    if (balanced) return 'Complete Two-Way';
    if (top('js')) return 'Sharpshooter';
    if (top('fin')) return 'Slasher';
    if (top('hnd')) return 'Ballhandler';
    if (top('pas')) return 'Playmaker';
    if (top('pd')) return 'Perimeter Stopper';
    if (top('spd')) return 'Downhill Attacker';
    if (top('bnc')) return 'Athletic Wing';
    if (top('iq')) return 'Cerebral Playmaker';
    return 'Star';
  }
  if (ovr >= 76) {
    if (top('js') && nine(js) && pd >= 7) return '3-and-D Specialist';
    if (top('js') && nine(js)) return 'Sharpshooter';
    if (top2('fin') && top2('spd') && eight(fin)) return 'Athletic Finisher';
    if (top2('bnc') && top2('fin')) return 'High-Flying Slasher';
    if (top('pas') && nine(pas)) return 'Pass-First Floor General';
    if (top('pd') && nine(pd) && spd >= 7) return 'Perimeter Lockdown';
    if (top2('hnd') && top2('pas') && eight(hnd)) return 'Ball-Dominant Guard';
    if (top2('js') && top2('pd')) return '3-and-D Role Player';
    if (top('iq') && eight(iq)) return 'Heady Playmaker';
    if (top2('spd') && top2('bnc') && spd >= 9) return 'Speed Demon';
    if (balanced) return 'Versatile Starter';
    if (top('js')) return 'Off-Ball Scorer';
    if (top('fin')) return 'Rim Runner';
    if (top('hnd')) return 'Ballhandler';
    if (top('pas')) return 'Facilitator';
    if (top('pd')) return 'Defensive Specialist';
    if (top('spd')) return 'Athletic Slasher';
    if (top('bnc')) return 'Athletic Starter';
    if (top('iq')) return 'Cerebral Veteran';
    return 'Solid Starter';
  }
  if (ovr >= 68) {
    if (top('js') && nine(js) && pd >= 7) return 'Catch-and-Shoot Specialist';
    if (top('js') && eight(js)) return 'Corner Three Specialist';
    if (top('fin') && eight(fin) && bnc >= 8) return 'High-Energy Rim Runner';
    if (top('fin') && eight(fin)) return 'Slashing Role Player';
    if (top('pd') && eight(pd)) return 'Defensive Stopper';
    if (top('hnd') && eight(hnd)) return 'Handles Backup';
    if (top('spd') && spd >= 9) return 'Explosive Athlete';
    if (top('bnc') && bnc >= 9) return 'High-Motor Athlete';
    if (spread >= 5) return 'Specialist Guard';
    if (balanced) return 'Rotational Piece';
    if (top('js')) return 'Spot-Up Shooter';
    if (top('fin')) return 'Slashing Backup';
    if (top('pas')) return 'Passing-First Backup';
    if (top('iq')) return 'Smart Role Player';
    return 'Bench Contributor';
  }
  return 'G-League Candidate';
}

function bigLabel(ovr: number, ctx: Ctx): string {
  const { get, spread, top, top2, top3, balanced } = ctx;
  const js = get('jumpShot');
  const fin = get('finishing');
  const pm = get('playmaking');
  const id = get('interiorDefense');
  const reb = get('rebounding');
  const spd = get('speed');
  const bnc = get('bounce');
  const sz = get('size');
  const iq = get('basketballIQ');
  const ten = (v: number) => v >= 10;
  const nine = (v: number) => v >= 9;
  const eight = (v: number) => v >= 8;
  const shooter = js >= 8;

  if (ovr >= 95) {
    if (ten(js) && ten(fin) && ten(id)) return 'Unstoppable Two-Way Big';
    if (ten(fin) && ten(reb) && ten(id)) return 'Dominant Anchor';
    if (ten(pm) && ten(iq) && ten(js)) return 'Unicorn Point-Center';
    if (ten(fin) && ten(sz) && ten(reb)) return 'Old-School Colossus';
    if (ten(spd) && ten(bnc) && ten(fin)) return 'Positionless Freak';
    if (balanced) return 'Generational';
    if (top('js') || top2('js')) return 'Transcendent Stretch';
    if (top('fin') || top2('fin')) return 'Transcendent Post Scorer';
    if (top('id') || top2('id')) return 'Transcendent Rim Protector';
    return 'Transcendent';
  }
  if (ovr >= 90) {
    if (top2('fin') && top2('bnc') && nine(fin)) return 'High-Flying Post Beast';
    if (top2('id') && top2('reb') && nine(sz)) return 'Elite Rim Protector';
    if (top2('js') && top2('id') && eight(js)) return 'Stretch-and-Protect Anchor';
    if (top2('fin') && top2('reb') && nine(fin)) return 'Double-Double Machine';
    if (top2('pm') && top2('js') && eight(pm)) return 'Playmaking Stretch Big';
    if (top2('id') && top2('pm') && nine(id)) return 'Elite Two-Way Big';
    if (top2('js') && top2('pm') && shooter) return 'Pick-and-Pop Maestro';
    if (top2('fin') && top2('id')) return 'Inside-Out Threat';
    if (top2('bnc') && top2('spd') && top3('fin')) return 'Modern Athletic Big';
    if (balanced) return 'Franchise Cornerstone';
    if (top('js')) return 'Elite Stretch';
    if (top('fin')) return 'Elite Post Scorer';
    if (top('id')) return 'Elite Rim Protector';
    if (top('reb')) return 'Elite Glass Cleaner';
    if (top('pm')) return 'Elite Playmaker';
    if (top('bnc')) return 'Elite Athlete';
    return 'Superstar';
  }
  if (ovr >= 84) {
    if (top2('bnc') && top2('fin') && eight(bnc) && eight(fin)) return 'High-Flying Slasher';
    if (top2('js') && top2('pm') && eight(js)) return 'Pick-and-Pop Playmaker';
    if (top2('fin') && top2('id') && eight(fin)) return 'Two-Way Post Scorer';
    if (top2('id') && top2('reb') && eight(id)) return 'Glass-Eating Anchor';
    if (top2('reb') && top2('fin') && eight(reb)) return 'Putback Machine';
    if (top2('spd') && top2('bnc') && eight(spd)) return 'Switchable Athlete';
    if (top2('pm') && top2('iq') && eight(pm)) return 'Cerebral Playmaker';
    if (top2('js') && shooter && top3('id')) return 'Floor-Spacing Shot Blocker';
    if (top2('fin') && top3('spd') && eight(fin)) return 'Mobile Post Scorer';
    if (balanced) return 'Versatile Two-Way';
    if (top('js')) return 'Stretch Four';
    if (top('fin')) return 'Post Scorer';
    if (top('id')) return 'Defensive Anchor';
    if (top('reb')) return 'Rebounding Monster';
    if (top('bnc')) return 'Vertical Threat';
    if (top('pm')) return 'Playmaking Center';
    if (top('spd')) return 'Mobile Forward';
    if (top('sz')) return 'Towering Presence';
    if (top('iq')) return 'High-IQ Veteran';
    return 'Star';
  }
  if (ovr >= 76) {
    if (top('js') && nine(js) && id >= 7) return 'Stretch-and-Protect';
    if (top('js') && nine(js)) return 'Pick-and-Pop Stretch';
    if (top2('id') && top2('reb') && eight(id)) return 'Defensive Specialist Big';
    if (top2('bnc') && top2('fin') && eight(bnc)) return 'High-Flying Finisher Big';
    if (top('fin') && nine(fin)) return 'Post Finisher';
    if (top('reb') && nine(reb)) return 'Glass Cleaner';
    if (top2('spd') && top2('bnc') && eight(spd)) return 'Switchable Athlete';
    if (top('pm') && nine(pm)) return 'Facilitating Center';
    if (top('id') && nine(id)) return 'Rim Protector';
    if (top2('sz') && sz >= 9) return 'Bruising Big';
    if (balanced) return 'Balanced Power Forward';
    if (top('js')) return 'Stretch Forward';
    if (top('fin')) return 'Post Scorer';
    if (top('id')) return 'Interior Defender';
    if (top('reb')) return 'Board Crasher';
    if (top('bnc')) return 'Athlete';
    if (top('spd')) return 'Mobile Forward';
    if (top('pm')) return 'Playmaker';
    if (top('iq')) return 'Heady Veteran';
    return 'Solid';
  }
  if (ovr >= 68) {
    if (top('js') && nine(js)) return 'Floor-Spacing Specialist';
    if (top('reb') && nine(reb)) return 'Rebounding Machine';
    if (top('id') && nine(id)) return 'Interior Enforcer';
    if (top2('bnc') && top2('fin') && eight(bnc)) return 'Above-the-Rim Finisher';
    if (top('fin') && eight(fin)) return 'Hustle Finisher';
    if (spread >= 5) return 'Specialist';
    if (balanced) return 'Versatile Role Player';
    if (top('js')) return 'Spot-Up Shooter';
    if (top('fin')) return 'Blue-Collar Finisher';
    if (top('id')) return 'Defensive Reserve';
    if (top('reb')) return 'Energy Rebounder';
    if (top('bnc')) return 'Lob Threat';
    return 'Bench Piece';
  }
  return 'G-League Candidate';
}
