import type { TomlValue } from './ast.js';
import { TomlTable, hasNewline, kv } from './ast.js';

/**
 * A TOML date or time. JavaScript only has `Date`, which can represent neither
 * a bare date nor a bare time and loses the written offset, so the original
 * text is kept instead.
 */
export class TomlDateTime {
  readonly raw: string;

  constructor(raw: string) {
    this.raw = raw;
  }

  toString(): string {
    return this.raw;
  }

  toJSON(): string {
    return this.raw;
  }

  /** Converts to a `Date`, when the writing carries enough information. */
  toDate(): Date {
    return new Date(this.raw.replace(' ', 'T'));
  }
}

/** JavaScript value equivalent to a TOML value. */
export type JsValue = string | number | bigint | boolean | TomlDateTime | Date | JsValue[] | { [key: string]: JsValue };

/**
 * Converts a document into a plain JavaScript object, usable with a JSONPath
 * library or a form.
 *
 * The object is a copy: changing it does not touch the document. Feed the
 * changes back with {@link applyJS}.
 */
export function toJS(table: TomlTable): { [key: string]: JsValue } {
  const out: { [key: string]: JsValue } = {};
  for (const entry of table.items) {
    define(out, entry.key, valueToJS(entry.val));
  }
  return out;
}

/** Assigns without triggering the `__proto__` setter. */
function define(obj: { [key: string]: JsValue }, key: string, value: JsValue): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function valueToJS(v: TomlValue): JsValue {
  switch (v.kind) {
    case 'string':
      return v.str;
    case 'boolean':
      return v.raw === 'true';
    case 'integer':
      return parseInteger(v.raw);
    case 'float':
      return parseFloatToml(v.raw);
    case 'datetime':
      return new TomlDateTime(v.raw);
    case 'array':
      return v.items.map(valueToJS);
    case 'table':
      return toJS(v.table);
  }
}

/** Integers outside the safe JavaScript range become `bigint`. */
function parseInteger(raw: string): number | bigint {
  const clean = raw.replaceAll('_', '');
  const big = BigInt(clean);
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}

function parseFloatToml(raw: string): number {
  const clean = raw.replaceAll('_', '').toLowerCase();
  if (clean.endsWith('inf')) return clean.startsWith('-') ? -Infinity : Infinity;
  if (clean.endsWith('nan')) return NaN;
  return Number(clean);
}

/**
 * Feeds the values of a JavaScript object back into the document, preserving
 * the whole presentation: comments, order, alignment, string styles.
 *
 * A key absent from the object is removed from the document; a new key is added
 * at the end of its table. The document is modified in place.
 */
export function applyJS(table: TomlTable, obj: { [key: string]: JsValue }): TomlTable {
  const keys = Object.keys(obj);
  const present = new Set(keys);

  for (const entry of [...table.items]) {
    if (!present.has(entry.key)) table.delete(entry.key);
  }
  for (const key of keys) {
    if (key === '__proto__') continue;
    const next = obj[key] as JsValue;
    const existing = table.get(key);
    if (!existing) {
      table.set(kv(key, fromJS(next)));
      continue;
    }
    const merged = mergeValue(existing.val, next);
    // A value that changes forbids rewriting the line from the source: this is what
    // tells a modified value apart from a formatting to keep.
    if (merged !== existing.val) {
      existing.val = merged;
      existing.dirty = true;
    }
  }
  return table;
}

/**
 * Applies a JavaScript value onto an existing TOML value, keeping its writing
 * whenever that remains possible.
 */
function mergeValue(old: TomlValue, next: JsValue): TomlValue {
  // Tables.
  if (old.kind === 'table' && isPlainObject(next)) {
    applyJS(old.table, next);
    return old;
  }

  // Arrays: the style of the first element serves as the model for added elements.
  if (old.kind === 'array' && Array.isArray(next)) {
    const model = old.items[0];
    const items = next.map((item, i) => {
      const previous = old.items[i] ?? model;
      return previous ? mergeValue(previous, item) : fromJS(item);
    });
    // Nothing moved: keep the original value, hence its exact writing.
    const unchanged = items.length === old.items.length && items.every((item, i) => item === old.items[i]);
    if (unchanged) return old;
    return { ...old, items, ofTables: old.ofTables && items.every((i) => i.kind === 'table') };
  }

  // Strings: the original style only holds when the shape is the same.
  if (old.kind === 'string' && typeof next === 'string') {
    if (old.str === next) return old;
    const multi = old.style === 'multi-basic' || old.style === 'multi-literal';
    if (hasNewline(next) === multi) return { kind: 'string', str: next, style: old.style };
    return fromJS(next);
  }

  // Numbers: JavaScript has a single numeric type. An unchanged value can come back
  // written differently (1_000 -> 1000, 0xff -> 255), and a round float comes back an
  // integer, which would break a typed decoder.
  if ((old.kind === 'integer' || old.kind === 'float') && (typeof next === 'number' || typeof next === 'bigint')) {
    if (sameNumber(old.raw, next)) return old;
    if (old.kind === 'float' && Number.isInteger(Number(next)) && Number.isFinite(Number(next))) {
      return { kind: 'float', raw: `${next}.0` };
    }
    return fromJS(next);
  }

  if (old.kind === 'boolean' && typeof next === 'boolean') {
    const raw = next ? 'true' : 'false';
    return old.raw === raw ? old : { kind: 'boolean', raw };
  }

  // Dates: a well formed string stays a TOML date rather than becoming text.
  if (old.kind === 'datetime') {
    const raw =
      next instanceof TomlDateTime ? next.raw
      : next instanceof Date ? next.toISOString()
      : typeof next === 'string' && isDateLike(next) ? next
      : null;
    if (raw !== null) return old.raw === raw ? old : { kind: 'datetime', raw };
  }

  return fromJS(next);
}

/** Builds a fresh TOML value from a JavaScript value. */
export function fromJS(value: JsValue): TomlValue {
  if (typeof value === 'string') {
    return { kind: 'string', str: value, style: hasNewline(value) ? 'multi-literal' : 'basic' };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', raw: value ? 'true' : 'false' };
  if (typeof value === 'bigint') return { kind: 'integer', raw: value.toString() };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { kind: 'float', raw: 'nan' };
    if (!Number.isFinite(value)) return { kind: 'float', raw: value > 0 ? 'inf' : '-inf' };
    if (Number.isInteger(value)) return { kind: 'integer', raw: String(value) };
    return { kind: 'float', raw: String(value) };
  }
  if (value instanceof TomlDateTime) return { kind: 'datetime', raw: value.raw };
  if (value instanceof Date) return { kind: 'datetime', raw: value.toISOString() };
  if (Array.isArray(value)) {
    const items = value.map(fromJS);
    return { kind: 'array', items, multiline: false, ofTables: items.length > 0 && items.every((i) => i.kind === 'table') };
  }
  const table = new TomlTable();
  // A fresh table born of an object is written inline when it is simple.
  table.dotted = true;
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__') continue;
    table.set(kv(k, fromJS(v as JsValue)));
  }
  return { kind: 'table', table };
}

function isPlainObject(v: JsValue): v is { [key: string]: JsValue } {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !(v instanceof TomlDateTime)
  );
}

function isDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(s) || /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
}

/** Compares the TOML writing of a number with a JavaScript value. */
function sameNumber(raw: string, next: number | bigint): boolean {
  const clean = raw.replaceAll('_', '').toLowerCase();
  if (typeof next === 'bigint') {
    try {
      return BigInt(clean) === next;
    } catch {
      return false;
    }
  }
  if (clean.endsWith('inf')) return next === (clean.startsWith('-') ? -Infinity : Infinity);
  if (clean.endsWith('nan')) return Number.isNaN(next);
  return Number(clean) === next;
}
