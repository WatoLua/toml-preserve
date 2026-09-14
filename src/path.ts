import type { TomlValue } from './ast.js';
import { TomlError, TomlTable, kv } from './ast.js';
import { applyJS, fromJS, type JsValue } from './js.js';

/**
 * Segments of a path. A string designates a key, a number an array index.
 */
export type PathSegment = string | number;

/**
 * Splits a textual path into segments.
 *
 * Accepts `profiles[0].quality_by_width."640"`, the bracket notation
 * `profiles[0]['quality_by_width']`, and a JSONPath-style `$.` prefix.
 */
export function parsePath(path: string | PathSegment[]): PathSegment[] {
  if (Array.isArray(path)) return path;
  const segments: PathSegment[] = [];
  let i = 0;
  if (path.startsWith('$')) i = path[1] === '.' ? 2 : 1;

  while (i < path.length) {
    const c = path[i]!;
    if (c === '.') {
      i++;
    } else if (c === '[') {
      i++;
      const q = path[i];
      if (q === '"' || q === "'") {
        i++;
        const end = path.indexOf(q, i);
        if (end < 0) throw new TomlError(`invalid path: unclosed quote in "${path}"`, 0);
        segments.push(path.slice(i, end));
        i = end + 1;
      } else {
        const end = path.indexOf(']', i);
        if (end < 0) throw new TomlError(`invalid path: missing ']' in "${path}"`, 0);
        const raw = path.slice(i, end).trim();
        if (!/^-?\d+$/.test(raw)) throw new TomlError(`invalid index "${raw}" in "${path}"`, 0);
        segments.push(Number(raw));
        i = end;
      }
      if (path[i] !== ']') throw new TomlError(`invalid path: missing ']' in "${path}"`, 0);
      i++;
    } else if (c === '"' || c === "'") {
      i++;
      const end = path.indexOf(c, i);
      if (end < 0) throw new TomlError(`invalid path: unclosed quote in "${path}"`, 0);
      segments.push(path.slice(i, end));
      i = end + 1;
    } else {
      let end = i;
      while (end < path.length && path[end] !== '.' && path[end] !== '[') end++;
      const seg = path.slice(i, end);
      if (seg === '') throw new TomlError(`empty segment in "${path}"`, 0);
      segments.push(seg);
      i = end;
    }
  }
  return segments;
}

/** Walks down the document and returns the raw value, or `undefined`. */
export function getValue(doc: TomlTable, path: string | PathSegment[]): TomlValue | undefined {
  let current: TomlValue = { kind: 'table', table: doc };
  for (const seg of parsePath(path)) {
    if (typeof seg === 'number') {
      if (current.kind !== 'array') return undefined;
      const item: TomlValue | undefined = current.items[seg < 0 ? current.items.length + seg : seg];
      if (!item) return undefined;
      current = item;
    } else {
      if (current.kind !== 'table') return undefined;
      const entry = current.table.get(seg);
      if (!entry) return undefined;
      current = entry.val;
    }
  }
  return current;
}

/**
 * Changes the value a path designates, leaving the rest of the file alone.
 *
 * The original writing is kept while it remains valid: a float stays one even
 * when the new value is round, and a string keeps its style. Missing
 * intermediate tables are created.
 *
 * @throws {TomlError} when the path crosses a value that is not a table.
 */
export function setPath(doc: TomlTable, path: string | PathSegment[], value: JsValue): void {
  const segments = parsePath(path);
  if (segments.length === 0) throw new TomlError('empty path', 0);

  let table = doc;
  let container: TomlValue = { kind: 'table', table: doc };

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (typeof seg === 'number') {
      if (container.kind !== 'array') throw new TomlError(`"${segments.slice(0, i).join('.')}" is not an array`, 0);
      const item: TomlValue | undefined = container.items[seg < 0 ? container.items.length + seg : seg];
      if (!item) throw new TomlError(`index ${seg} is out of bounds in "${segments.slice(0, i).join('.')}"`, 0);
      container = item;
      if (item.kind === 'table') table = item.table;
      continue;
    }
    if (container.kind !== 'table') throw new TomlError(`"${segments.slice(0, i + 1).join('.')}" is not a table`, 0);
    table = container.table;
    const entry = table.get(seg);
    if (!entry) {
      const child = new TomlTable();
      table.set(kv(seg, { kind: 'table', table: child }));
      container = { kind: 'table', table: child };
      table = child;
      continue;
    }
    container = entry.val;
    if (entry.val.kind === 'table') table = entry.val.table;
  }

  const leaf = segments[segments.length - 1]!;
  if (typeof leaf === 'number') {
    if (container.kind !== 'array') throw new TomlError(`"${segments.slice(0, -1).join('.')}" is not an array`, 0);
    const index = leaf < 0 ? container.items.length + leaf : leaf;
    const previous = container.items[index] ?? container.items[0];
    const updated = previous ? applyOn(previous, value) : fromJS(value);
    if (updated !== container.items[index]) {
      container.items[index] = updated;
      container.dirty = true;
    }
    return;
  }
  if (container.kind !== 'table') throw new TomlError(`"${segments.slice(0, -1).join('.')}" is not a table`, 0);
  table = container.table;
  const existing = table.get(leaf);
  if (!existing) {
    table.set(kv(leaf, fromJS(value)));
    return;
  }
  const updated = applyOn(existing.val, value);
  if (updated !== existing.val) {
    existing.val = updated;
    existing.dirty = true;
  }
}

/** Removes the designated key. Returns `false` when it did not exist. */
export function deletePath(doc: TomlTable, path: string | PathSegment[]): boolean {
  const segments = parsePath(path);
  if (segments.length === 0) return false;
  const parent = segments.length === 1 ? { kind: 'table' as const, table: doc } : getValue(doc, segments.slice(0, -1));
  if (!parent) return false;
  const leaf = segments[segments.length - 1]!;
  if (typeof leaf === 'number') {
    if (parent.kind !== 'array') return false;
    const index = leaf < 0 ? parent.items.length + leaf : leaf;
    if (index < 0 || index >= parent.items.length) return false;
    parent.items.splice(index, 1);
    return true;
  }
  if (parent.kind !== 'table') return false;
  return parent.table.delete(leaf);
}

/**
 * Applies a JavaScript value onto an existing value keeping its writing, by
 * reusing the merge of `applyJS` through a temporary table.
 */
function applyOn(previous: TomlValue, value: JsValue): TomlValue {
  const holder = new TomlTable();
  holder.set(kv('v', previous));
  applyJS(holder, { v: value });
  return holder.get('v')?.val ?? fromJS(value);
}
