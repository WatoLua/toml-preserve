import type { KV, KeyQuote, Span, TomlValue } from './ast.js';
import { TomlTable, hasNewline, isPristine, isTableArray } from './ast.js';

export interface StringifyOptions {
  /** Indentation of an element inside an exploded array. Defaults to two spaces. */
  indent?: string;
  /** Width past which an array spreads over several lines. 0 means never. */
  wrapWidth?: number;
  /** Style of short strings when normalising. Defaults to `double`. */
  quote?: 'double' | 'single' | 'preserve';
  /** Paths of tables to write as `[section]`, e.g. `profiles.quality_by_width`. */
  forceSection?: string[];
  /** Paths of tables to write as inline tables. */
  forceInline?: string[];
  /**
   * Keeps the style of the source: alignment of the `=`, spacing of the comments,
   * quotes, exploded arrays. On by default, which makes `stringify(parse(t))`
   * identical to `t`.
   */
  preserveStyle?: boolean;
  /** Sorts keys alphabetically instead of keeping the original order. */
  sortKeys?: boolean;
}

interface Resolved extends Required<StringifyOptions> {
  /** Parsed text, to rewrite untouched what has not changed. */
  source: string;
}

/**
 * Rewrites a TOML document. The original presentation is kept by default, so only
 * the values changed in the meantime differ in the text produced.
 */
export function stringify(doc: TomlTable, options: StringifyOptions = {}): string {
  const opt: Resolved = {
    indent: options.indent ?? (options.preserveStyle === false ? '  ' : doc.indentHint || '  '),
    wrapWidth: options.wrapWidth ?? 100,
    quote: options.quote ?? 'double',
    forceSection: options.forceSection ?? [],
    forceInline: options.forceInline ?? [],
    preserveStyle: options.preserveStyle ?? true,
    sortKeys: options.sortKeys ?? false,
    source: doc.sourceText,
  };
  const out: string[] = [];
  renderTable(out, [], doc, opt);
  for (const c of doc.trailing) {
    blankLine(out);
    out.push('#' + c);
  }
  const text = out.join('\n').replace(/\n+$/, '');
  return text === '' ? '' : text + '\n';
}

/** Counts visible characters, so an accent does not count twice. */
function width(s: string): number {
  return [...s].length;
}

function blankLine(out: string[]): void {
  if (out.length === 0) return;
  const last = out[out.length - 1] ?? '';
  if (last === '' || last.endsWith('\n')) return;
  out.push('');
}

/** Picks a fragment out of the parsed text. */
function slice(span: Span | null, opt: Resolved): string | null {
  if (!span || !opt.source) return null;
  return opt.source.slice(span.start, span.end);
}

/**
 * Rewrites the comments and blank lines that preceded an entry, as they were.
 * Returns `false` when the source is not available.
 */
function emitTrivia(out: string[], span: Span | null, opt: Resolved): boolean {
  const text = slice(span, opt);
  if (text === null) return false;
  if (text !== '') out.push(text.replace(/\n$/, ''));
  return true;
}

/** Writes a table: the plain pairs first, then the subsections. */
function renderTable(out: string[], path: string[], table: TomlTable, opt: Resolved): void {
  let items = table.items;
  if (opt.sortKeys) items = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const decided = items.map((entry) => ({ entry, section: isSection([...path, entry.key], entry.val, opt) }));

  // An entry added afterwards has no indentation of its own: it takes that of its
  // neighbours rather than sticking to the margin.
  const fallbackIndent = items.find((entry) => entry.src !== null && entry.indent !== '')?.indent ?? table.indent;

  for (const { entry, section } of decided) {
    if (!section) renderPair(out, entry, fallbackIndent, opt);
  }
  for (const { entry, section } of decided) {
    if (!section) continue;
    const sub = [...path, entry.key];
    if (entry.val.kind === 'array') {
      for (const item of entry.val.items) {
        if (item.kind !== 'table') continue;
        renderHeader(out, sub, item.table, entry.keyQuote, true, opt);
        renderTable(out, sub, item.table, opt);
      }
    } else if (entry.val.kind === 'table') {
      renderHeader(out, sub, entry.val.table, entry.keyQuote, false, opt);
      renderTable(out, sub, entry.val.table, opt);
    }
  }
}

function renderHeader(
  out: string[],
  path: string[],
  table: TomlTable,
  quote: KeyQuote,
  isArray: boolean,
  opt: Resolved,
): void {
  // An implicit table with no value of its own needs no header.
  if (table.implicit && !table.items.some((e) => !isSection([...path, e.key], e.val, opt))) return;

  if (opt.preserveStyle && table.headerSrc) {
    const original = slice(table.headerSrc, opt);
    if (original !== null) {
      emitTrivia(out, table.triviaSrc, opt);
      out.push(table.indent + original);
      return;
    }
  }

  if (!emitTrivia(out, table.triviaSrc, opt)) {
    blankLine(out);
    for (const c of table.comments) out.push(table.indent + '#' + c);
  }
  const name = path.map((seg, i) => renderKey(seg, i === path.length - 1 ? quote : '', opt)).join('.');
  let head = isArray ? `[[${name}]]` : `[${name}]`;
  if (table.inlineComment) head += pad(table.inlineCommentPad, opt) + '#' + table.inlineComment;
  out.push(table.indent + head);
}

function renderPair(out: string[], entry: KV, fallbackIndent: string, opt: Resolved): void {
  // An untouched entry is rewritten exactly as it was: indentation, spacing, array
  // explosion, all kept without interpretation.
  if (opt.preserveStyle && !entry.dirty && entry.src && isPristine(entry.val)) {
    const original = slice(entry.src, opt);
    if (original !== null) {
      emitTrivia(out, entry.triviaSrc, opt);
      out.push(entry.indent + original);
      return;
    }
  }

  const indent = entry.src === null && entry.indent === '' ? fallbackIndent : entry.indent;

  if (!emitTrivia(out, entry.triviaSrc, opt)) {
    if (entry.blankBefore > 0 || entry.comments.length > 0) blankLine(out);
    for (const c of entry.comments) out.push(indent + '#' + c);
  }

  // A table born of dotted keys (`a.b = 1`) is rewritten as such.
  const leaves = dottedLeaves(entry, opt);
  if (leaves) {
    for (const leaf of leaves) {
      out.push(indent + `${leaf.key} = ${renderValue(leaf.val, width(leaf.key) + 3, indent, opt)}`);
    }
    return;
  }

  const key = renderKey(entry.key, entry.keyQuote, opt);
  let prefix = key + ' = ';
  if (opt.preserveStyle && entry.alignCol > width(key) + 1) {
    prefix = key + ' '.repeat(entry.alignCol - width(key)) + '= ';
  }
  let line = prefix + renderValue(entry.val, width(indent + prefix), indent, opt);
  if (entry.inlineComment) line += pad(entry.inlineCommentPad, opt) + '#' + entry.inlineComment;
  out.push(indent + line);
}

/**
 * Expands an entry whose value comes from dotted keys into a list of
 * `parent.child = value` pairs. Returns `null` when the entry is not in that
 * case, or when the formatting is being normalised.
 */
function dottedLeaves(entry: KV, opt: Resolved): { key: string; val: TomlValue }[] | null {
  if (!opt.preserveStyle) return null;
  if (entry.val.kind !== 'table' || !entry.val.table.dotted || entry.val.table.inline) return null;

  const out: { key: string; val: TomlValue }[] = [];
  const walk = (prefix: string, table: TomlTable): void => {
    for (const child of table.items) {
      const key = `${prefix}.${renderKey(child.key, child.keyQuote, opt)}`;
      if (child.val.kind === 'table' && child.val.table.dotted && !child.val.table.inline) walk(key, child.val.table);
      else out.push({ key, val: child.val });
    }
  };
  walk(renderKey(entry.key, entry.keyQuote, opt), entry.val.table);
  return out.length > 0 ? out : null;
}

/** Reproduces the spacing of an end-of-line comment. */
function pad(n: number, opt: Resolved): string {
  return opt.preserveStyle && n >= 1 ? ' '.repeat(n) : ' ';
}

/** Decides whether a value is written as a `[section]` rather than in place. */
function isSection(path: string[], v: TomlValue, opt: Resolved): boolean {
  const full = path.join('.');
  if (isTableArray(v)) {
    if (opt.forceInline.includes(full)) return false;
    // An array of tables written inline stays inline in faithful mode; converting it
    // to [[sections]] is what `format` is for.
    if (opt.preserveStyle && v.kind === 'array' && !v.ofTables) return false;
    return true;
  }
  if (v.kind !== 'table') return false;
  if (opt.forceSection.includes(full)) return true;
  if (opt.forceInline.includes(full)) return false;
  // A table written inline or through dotted keys stays that way as long as it holds
  // scalars only.
  return !((v.table.inline || v.table.dotted) && v.table.allScalars());
}

function renderValue(v: TomlValue, col: number, indent: string, opt: Resolved): string {
  switch (v.kind) {
    case 'string':
      return renderString(v.str, v.style, opt);
    case 'integer':
    case 'float':
    case 'boolean':
    case 'datetime':
      return v.raw;
    case 'table': {
      if (v.table.items.length === 0) return '{}';
      const parts: string[] = [];
      for (const e of v.table.items) {
        const leaves = dottedLeaves(e, opt);
        if (leaves) {
          for (const leaf of leaves) parts.push(`${leaf.key} = ${renderValue(leaf.val, 0, indent, opt)}`);
        } else {
          parts.push(`${renderKey(e.key, e.keyQuote, opt)} = ${renderValue(e.val, 0, indent, opt)}`);
        }
      }
      return `{ ${parts.join(', ')} }`;
    }
    case 'array':
      return renderArray(v, col, indent, opt);
  }
}

function renderArray(
  v: Extract<TomlValue, { kind: 'array' }>,
  col: number,
  indent: string,
  opt: Resolved,
): string {
  if (v.items.length === 0) return '[]';
  const parts = v.items.map((item) => renderValue(item, 0, indent + opt.indent, opt));

  let oneLine = !parts.some((p) => p.includes('\n'));
  if (opt.preserveStyle && v.multiline) oneLine = false;
  const flat = `[${parts.join(', ')}]`;
  if (oneLine && opt.wrapWidth > 0 && col + width(flat) > opt.wrapWidth) oneLine = false;
  if (oneLine) return flat;

  const inner = parts.map((p) => `${indent}${opt.indent}${p},`).join('\n');
  return `[\n${inner}\n${indent}]`;
}

function renderString(s: string, style: StringStyleLike, opt: Resolved): string {
  // In faithful mode the original writing wins, as long as it still suits the current
  // value.
  if (opt.preserveStyle || opt.quote === 'preserve') {
    const kept = renderInStyle(s, style);
    if (kept !== null) return kept;
  }
  if (hasNewline(s)) {
    // A multiline literal reads best for embedded JSON or SQL.
    if (canMultiLiteral(s)) return `'''\n${s}'''`;
    return `"""\n${escapeMultiBasic(s)}"""`;
  }
  if (opt.quote === 'single' && !s.includes("'") && isPrintable(s)) return `'${s}'`;
  // A literal avoids escaping quotes and backslashes.
  if (/["\\]/.test(s) && !s.includes("'") && isPrintable(s)) return `'${s}'`;
  return quoteBasic(s);
}

type StringStyleLike = 'basic' | 'literal' | 'multi-basic' | 'multi-literal';

/**
 * Rewrites a string in the requested style, or `null` when that style can no
 * longer carry it: an apostrophe appearing in a literal, a newline in a simple
 * string.
 */
function renderInStyle(s: string, style: StringStyleLike): string | null {
  switch (style) {
    case 'basic':
      // Double quotes escape everything, newlines included.
      return quoteBasic(s);
    case 'literal':
      return !hasNewline(s) && !s.includes("'") && isPrintable(s) ? `'${s}'` : null;
    case 'multi-basic':
      return `"""\n${escapeMultiBasic(s)}"""`;
    case 'multi-literal':
      return canMultiLiteral(s) ? `'''\n${s}'''` : null;
  }
}

/** Whether the string can fit in a `''' '''` literal. */
function canMultiLiteral(s: string): boolean {
  if (s.includes("'''") || s.endsWith("'") || s.includes('\r')) return false;
  return ![...s].some((c) => c !== '\n' && c !== '\t' && (c < ' ' || c === '\x7f'));
}

function isPrintable(s: string): boolean {
  return ![...s].some((c) => c < ' ' || c === '\x7f');
}

function escapeMultiBasic(s: string): string {
  let out = '';
  for (const c of s) {
    if (c === '\n' || c === '\t') out += c;
    else if (c === '\\') out += '\\\\';
    else out += escapeChar(c);
  }
  return out.replaceAll('"""', '""\\"');
}

function quoteBasic(s: string): string {
  let out = '"';
  for (const c of s) {
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else out += escapeChar(c);
  }
  return out + '"';
}

function escapeChar(c: string): string {
  switch (c) {
    case '\b': return '\\b';
    case '\t': return '\\t';
    case '\n': return '\\n';
    case '\f': return '\\f';
    case '\r': return '\\r';
    default:
      if (c < ' ' || c === '\x7f') {
        return '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      }
      return c;
  }
}

/**
 * Writes a key, quoted when needed. A numeric key gets its quotes even though
 * TOML allows it bare, so that `"75"` stays readably a string.
 */
export function renderKey(key: string, quote: KeyQuote, opt: Resolved | StringifyOptions): string {
  if (key === '') return '""';
  if (opt.preserveStyle) {
    if (quote === "'" && !key.includes("'")) return `'${key}'`;
    if (quote === '"') return quoteBasic(key);
    // A key written bare in the source stays bare when it is valid that way.
    if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
  }
  const bare = /^[A-Za-z0-9_-]+$/.test(key) && !/^[0-9-]/.test(key);
  if (bare) return key;
  if (/["\\]/.test(key) && !key.includes("'") && isPrintable(key)) return `'${key}'`;
  return quoteBasic(key);
}
