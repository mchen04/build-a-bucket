import * as v from 'valibot';
import { DATA_BASE, GUARD_ATTRS, BIG_ATTRS } from '../engine/rules';
import type { MomentEffect, Position } from '../engine/types';
import { DataError, fetchSource } from './loader';

const MOMENT_FILE = 'src/lib/scenarios.js';
const ROLE_ATTRS: Record<Position, Record<string, readonly string[]>> = {
  guard: {
    legs: ['speed', 'bounce'],
    feel: ['jumpShot'],
    mind: ['basketballIQ'],
    nerve: ['clutch'],
    power: ['finishing'],
    make: ['handles', 'passing'],
  },
  big: {
    legs: ['bounce', 'speed'],
    feel: ['finishing'],
    mind: ['basketballIQ'],
    nerve: ['clutch'],
    power: ['rebounding', 'interiorDefense'],
    make: ['playmaking'],
  },
};

export interface MomentTemplate {
  id: string;
  at: string[];
  weight: number;
  requires: 'alive' | 'clinched' | 'eliminated' | 'playoffs';
  minLeft: number;
  kicker: string;
  title: string;
  body: string;
  options: Array<{ id: string; label: string; flavor: string; effect: MomentEffect }>;
}

export interface MomentBank {
  templates: MomentTemplate[];
  skipped: string[];
}

const templateSchema = v.object({
  id: v.string(),
  at: v.array(v.string()),
  weight: v.number(),
  requires: v.picklist(['alive', 'clinched', 'eliminated', 'playoffs']),
  minLeft: v.number(),
  kicker: v.string(),
  title: v.string(),
  body: v.string(),
  options: v.array(
    v.object({
      id: v.string(),
      label: v.string(),
      flavor: v.string(),
      effect: v.any(),
    }),
  ),
});

type Literal =
  | string
  | number
  | boolean
  | null
  | Literal[]
  | { [key: string]: Literal }
  | { call: string; args: Literal[] }
  | { ref: string };

class Reader {
  constructor(
    private readonly text: string,
    public index = 0,
  ) {}

  private skip(): void {
    for (;;) {
      const char = this.text[this.index];
      if (char === undefined) return;
      if (/\s/.test(char)) {
        this.index++;
        continue;
      }
      if (char === '/' && this.text[this.index + 1] === '/') {
        const end = this.text.indexOf('\n', this.index);
        this.index = end === -1 ? this.text.length : end + 1;
        continue;
      }
      if (char === '/' && this.text[this.index + 1] === '*') {
        const end = this.text.indexOf('*/', this.index);
        this.index = end === -1 ? this.text.length : end + 2;
        continue;
      }
      return;
    }
  }

  peek(): string | undefined {
    this.skip();
    return this.text[this.index];
  }

  readString(quote: string): string {
    this.index++;
    let out = '';
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char === '\\') {
        const next = this.text[this.index + 1];
        if (next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else if (next === 'u') {
          out += String.fromCharCode(parseInt(this.text.slice(this.index + 2, this.index + 6), 16));
          this.index += 6;
          continue;
        } else out += next;
        this.index += 2;
        continue;
      }
      if (char === quote) {
        this.index++;
        return out;
      }
      if (quote === '`' && char === '$' && this.text[this.index + 1] === '{') {
        const start = this.index + 2;
        let depth = 1;
        let cursor = start;
        while (cursor < this.text.length && depth > 0) {
          if (this.text[cursor] === '{') depth++;
          else if (this.text[cursor] === '}') depth--;
          cursor++;
        }
        out += `{{${this.text.slice(start, cursor - 1).trim()}}}`;
        this.index = cursor;
        continue;
      }
      out += char;
      this.index++;
    }
    throw new DataError('Unterminated string in the moment bank');
  }

  readValue(): Literal {
    const char = this.peek();
    if (char === undefined) throw new DataError('Unexpected end of the moment bank');
    if (char === "'" || char === '"' || char === '`') return this.readString(char);
    if (char === '{') return this.readObject();
    if (char === '[') return this.readArray();
    if (char === '-' || /[0-9]/.test(char)) {
      const match = /^-?[0-9.]+/.exec(this.text.slice(this.index));
      if (!match) throw new DataError('Bad number in the moment bank');
      this.index += match[0].length;
      return Number(match[0]);
    }
    return this.readIdentifier();
  }

  readObject(): Literal {
    this.index++;
    const out: { [key: string]: Literal } = {};
    for (;;) {
      this.skip();
      if (this.text[this.index] === '}') {
        this.index++;
        return out;
      }
      let key: string;
      const char = this.text[this.index];
      if (char === "'" || char === '"' || char === '`') key = this.readString(char);
      else {
        const match = /^[A-Za-z_$][\w$]*/.exec(this.text.slice(this.index));
        if (!match) throw new DataError('Bad key in the moment bank');
        key = match[0];
        this.index += key.length;
      }
      this.skip();
      if (this.text[this.index] !== ':') throw new DataError(`Missing ':' after ${key}`);
      this.index++;
      out[key] = this.readValue();
      this.skip();
      if (this.text[this.index] === ',') this.index++;
    }
  }

  readArray(): Literal {
    this.index++;
    const out: Literal[] = [];
    for (;;) {
      this.skip();
      if (this.text[this.index] === ']') {
        this.index++;
        return out;
      }
      out.push(this.readValue());
      this.skip();
      if (this.text[this.index] === ',') this.index++;
    }
  }

  readIdentifier(): Literal {
    const match = /^[A-Za-z_$][\w$.]*/.exec(this.text.slice(this.index));
    if (!match) throw new DataError('Bad identifier in the moment bank');
    this.index += match[0].length;
    this.skip();
    if (this.text[this.index] !== '(') {
      if (match[0] === 'true') return true;
      if (match[0] === 'false') return false;
      if (match[0] === 'null') return null;
      return { ref: match[0] };
    }
    this.index++;
    const args: Literal[] = [];
    for (;;) {
      this.skip();
      if (this.text[this.index] === ')') {
        this.index++;
        return { call: match[0], args };
      }
      args.push(this.readValue());
      this.skip();
      if (this.text[this.index] === ',') this.index++;
    }
  }
}

function roleDeltas(position: Position, call: { call: string; args: Literal[] }): Record<string, number> {
  const role = typeof call.args[0] === 'string' ? call.args[0] : '';
  const amount = typeof call.args[1] === 'number' ? call.args[1] : 0;
  const count = call.call.endsWith('R1') ? 1 : typeof call.args[2] === 'number' ? call.args[2] : 2;
  const attrs = ROLE_ATTRS[position][role] ?? [];
  return Object.fromEntries(attrs.slice(0, count).map((attr) => [attr, amount]));
}

function attrFromCall(value: Literal, position: Position): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('call' in value)) return null;
  const call = value as { call: string; args: Literal[] };
  if (call.call !== 'mix' && !call.call.endsWith('.R') && !call.call.endsWith('.R1')) return null;
  const parts = call.call === 'mix' ? call.args : [value];
  const attr: Record<string, number> = {};
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part) || !('call' in part)) return null;
    const deltas = roleDeltas(position, part as { call: string; args: Literal[] });
    for (const [key, amount] of Object.entries(deltas)) attr[key] = (attr[key] ?? 0) + amount;
  }
  return Object.keys(attr).length ? attr : null;
}

function interpretEffect(value: Literal, position: Position, skipped: string[], momentId: string): MomentEffect | null {
  const unsupported = (what: string): null => {
    skipped.push(`${momentId}: ${what}`);
    return null;
  };
  const asEffect = (entry: Literal): MomentEffect | null => interpretEffect(entry, position, skipped, momentId);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unsupported('effect is not an object');
  if ('call' in value) {
    const call = value as { call: string; args: Literal[] };
    if (call.call === 'gam') {
      const p = typeof call.args[0] === 'number' ? call.args[0] : null;
      if (p === null) return unsupported('gamble without a probability');
      const hit = asEffect(call.args[1] ?? {});
      const miss = asEffect(call.args[3] ?? {});
      if (!hit || !miss) return null;
      const hitLine = typeof call.args[2] === 'string' ? call.args[2] : undefined;
      const missLine = typeof call.args[4] === 'string' ? call.args[4] : undefined;
      return { gamble: { p, hit, miss, hitLine, missLine } };
    }
    if (call.call === 'mix' || call.call.endsWith('.R') || call.call.endsWith('.R1')) {
      const parts = call.call === 'mix' ? call.args : [call];
      const attr: Record<string, number> = {};
      for (const part of parts) {
        if (!part || typeof part !== 'object' || Array.isArray(part) || !('call' in part)) {
          return unsupported('trait change is not a role call');
        }
        const deltas = roleDeltas(position, part as { call: string; args: Literal[] });
        for (const [key, amount] of Object.entries(deltas)) attr[key] = (attr[key] ?? 0) + amount;
      }
      return Object.keys(attr).length ? { attr } : null;
    }
    if (call.call === 'dealFx') {
      const flat = call.args[2];
      const team: { off?: number; def?: number } = {};
      if (flat && typeof flat === 'object' && !Array.isArray(flat) && !('ref' in flat) && !('call' in flat)) {
        for (const [side, amount] of Object.entries(flat as { [key: string]: Literal })) {
          if ((side === 'off' || side === 'def') && typeof amount === 'number') team[side] = amount;
        }
      }
      return { team, deals: true };
    }
    return unsupported(`call ${call.call}`);
  }
  const object = value as { [key: string]: Literal };
  const effect: MomentEffect = {};
  for (const [key, entry] of Object.entries(object)) {
    if (key === 'attr') {
      const fromCall = attrFromCall(entry, position);
      if (fromCall) {
        effect.attr = fromCall;
        continue;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || 'ref' in entry) return unsupported('attr is not an object');
      const attr: Record<string, number> = {};
      for (const [name, amount] of Object.entries(entry as { [key: string]: Literal })) {
        if (typeof amount !== 'number') return unsupported(`attr ${name} is not a number`);
        attr[name] = amount;
      }
      effect.attr = attr;
    } else if (key === 'team') {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return unsupported('team is not an object');
      const team: { off?: number; def?: number } = {};
      for (const [side, amount] of Object.entries(entry as { [key: string]: Literal })) {
        if (side !== 'off' && side !== 'def') return unsupported(`team.${side}`);
        if (typeof amount !== 'number') return unsupported(`team.${side} is not a number`);
        team[side] = amount;
      }
      effect.team = team;
    } else if (key === 'sit') {
      if (typeof entry === 'number') effect.sit = entry;
      else if (entry && typeof entry === 'object' && 'ref' in entry) effect.sit = -1;
      else return unsupported('sit is not a number');
    } else if (key === 'tag' || key === 'line') {
      if (typeof entry !== 'string') return unsupported(`${key} is not text`);
      if (key === 'tag') effect.tag = entry;
    } else if (key === 'window' || key === 'dur' || key === 'xp') {
      if (typeof entry !== 'number') return unsupported(`${key} is not a number`);
      effect[key] = entry;
    } else if (key === 'then') {
      const then = asEffect(entry);
      if (!then) return null;
      effect.then = then;
    } else if (key === 'gamble') {
      const gamble = asEffect(entry);
      if (!gamble?.gamble) return unsupported('gamble');
      effect.gamble = gamble.gamble;
    }
  }
  return effect;
}

function sliceExport(source: string, name: string): string | null {
  const start = source.indexOf(`const ${name} = [`);
  if (start === -1) return null;
  const open = source.indexOf('[', start);
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = open; index < source.length; index++) {
    const char = source[index] as string;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return null;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index] as string;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function readProperty(chunk: string, key: string): Literal | null {
  const match = new RegExp(`(?:^|[{,\\s])${key}\\s*:`).exec(chunk);
  if (!match) return null;
  try {
    return new Reader(chunk, match.index + match[0].length).readValue();
  } catch {
    return null;
  }
}

function requires(text: string): { requires: MomentTemplate['requires']; minLeft: number } {
  const minLeft = Number(/(\d+)/.exec(/left\s*>=\s*\d+/.exec(text)?.[0] ?? '')?.[0] ?? 0);
  if (text.includes('clinched')) return { requires: 'clinched', minLeft };
  if (text.includes('eliminated')) return { requires: 'eliminated', minLeft };
  return { requires: 'alive', minLeft };
}

export function parseMomentBank(source: string, position: Position): MomentBank {
  const skipped: string[] = [];
  const templates: MomentTemplate[] = [];
  for (const name of ['NBA_ALL', 'NBA_PLAYOFFS']) {
    const array = sliceExport(source, name);
    if (!array) {
      skipped.push(`${name}: not found`);
      continue;
    }
    for (const chunk of splitTopLevel(array.slice(1, -1))) {
      const id = readProperty(chunk, 'id');
      if (typeof id !== 'string') continue;
      const at = readProperty(chunk, 'at');
      const w = readProperty(chunk, 'w');
      const kicker = readProperty(chunk, 'kicker');
      const title = readProperty(chunk, 'title');
      const body = readProperty(chunk, 'body');
      const optionsArray = readProperty(chunk, 'options');
      const when = /when:\s*([^,]+?),\s*(?:make|options)/.exec(chunk)?.[1] ?? '';
      const { requires: need, minLeft } = requires(when);
      if (typeof kicker !== 'string' || typeof title !== 'string' || typeof body !== 'string' || !Array.isArray(optionsArray)) {
        skipped.push(`${id}: text is not a literal`);
        continue;
      }
      const options: MomentTemplate['options'] = [];
      for (const optionChunk of optionsArray) {
        if (!optionChunk || typeof optionChunk !== 'object' || Array.isArray(optionChunk) || !('call' in optionChunk)) {
          skipped.push(`${id}: option is not a call`);
          continue;
        }
        const call = optionChunk as { call: string; args: Literal[] };
        if (call.call !== 'o') {
          skipped.push(`${id}: option helper ${call.call}`);
          continue;
        }
        const [optionId, label, effectValue, flavor] = call.args;
        if (typeof optionId !== 'string' || typeof label !== 'string') {
          skipped.push(`${id}: option without a label`);
          continue;
        }
        const effect = interpretEffect(effectValue ?? {}, position, skipped, id);
        if (!effect) continue;
        options.push({ id: optionId, label, flavor: typeof flavor === 'string' ? flavor : '', effect });
      }
      if (options.length < 2) {
        skipped.push(`${id}: fewer than two usable options`);
        continue;
      }
      const candidate = {
        id,
        at: Array.isArray(at) ? at.filter((entry): entry is string => typeof entry === 'string') : [],
        weight: typeof w === 'number' ? w : 1,
        requires: need,
        minLeft,
        kicker,
        title,
        body,
        options,
      };
      const parsed = v.safeParse(templateSchema, candidate);
      if (!parsed.success) {
        skipped.push(`${id}: ${parsed.issues[0]?.message ?? 'schema'}`);
        continue;
      }
      templates.push(candidate);
    }
  }
  return { templates, skipped };
}

export async function loadMomentBank(position: Position): Promise<MomentBank> {
  const source = await fetchSource(MOMENT_FILE);
  return parseMomentBank(source, position);
}

export function renderMomentText(text: string, ctx: Record<string, string | number>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const trimmed = raw.trim();
    const key = trimmed.replace(/^c\./, '');
    const value = ctx[trimmed] ?? ctx[key];
    return value === undefined ? '' : String(value);
  });
}

export function momentAttrs(position: Position): readonly string[] {
  return position === 'guard' ? GUARD_ATTRS : BIG_ATTRS;
}

export { DATA_BASE };
