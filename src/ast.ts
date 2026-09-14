/**
 * TOML syntax tree holding the presentation of the source.
 *
 * A JavaScript object carries key order, comments, alignment and writing style
 * nowhere; this tree carries them, so a file can be rewritten without being
 * disfigured.
 */

/** Writing style of a string, preserved when rewriting. */
export type StringStyle = 'basic' | 'literal' | 'multi-basic' | 'multi-literal';

/** Writing style of a key. */
export type KeyQuote = '' | '"' | "'";

/** Span of a fragment in the source text, in character indices. */
export interface Span {
  start: number;
  end: number;
}

/** A TOML value. Non-string scalars keep their exact writing. */
export type TomlValue =
  | { kind: 'string'; str: string; style: StringStyle }
  | { kind: 'integer' | 'float' | 'boolean' | 'datetime'; raw: string }
  | { kind: 'array'; items: TomlValue[]; multiline: boolean; ofTables: boolean; dirty?: boolean }
  | { kind: 'table'; table: TomlTable };

/** A table entry: its key, its value and the layout surrounding it. */
export interface KV {
  key: string;
  keyQuote: KeyQuote;
  val: TomlValue;
  /** Comments on the lines preceding the entry, without the `#`. */
  comments: string[];
  /** Number of blank lines to leave before the entry. */
  blankBefore: number;
  /** End-of-line comment, without the `#`. */
  inlineComment: string;
  /** Spaces between the value and the `#` of the end-of-line comment. */
  inlineCommentPad: number;
  /**
   * Column of the `=` counted from the start of the key, to reproduce a block
   * aligned by hand. Independent of indentation.
   */
  alignCol: number;
  /** Indentation of the line in the source. */
  indent: string;
  /** Span of `key = value  # comment`, indentation excluded. */
  src: Span | null;
  /** Span of the comments and blank lines preceding the entry. */
  triviaSrc: Span | null;
  /**
   * True once the value has been replaced: the entry can no longer be rewritten
   * from the source and has to be recomposed.
   */
  dirty: boolean;
}

/** TOML table preserving the insertion order of its keys. */
export class TomlTable {
  items: KV[] = [];
  private index = new Map<string, KV>();

  /** Written `{ a = 1 }` in the source. */
  inline = false;
  /** Exists only through dotted keys (`a.b = 1`). */
  dotted = false;
  /** Created by a child header, with no header of its own. */
  implicit = false;

  comments: string[] = [];
  blankBefore = 0;
  inlineComment = '';
  inlineCommentPad = 0;

  /** Indentation of the header line in the source. */
  indent = '';
  /** Span of the `[section]` line, indentation excluded. */
  headerSrc: Span | null = null;
  /** Span of the comments and blank lines preceding the header. */
  triviaSrc: Span | null = null;
  /** True when keys have been added or removed since parsing. */
  dirty = false;

  /** Orphan comments at the end of the file (root table only). */
  trailing: string[] = [];

  /** Parsed text, kept to rewrite identically (root table only). */
  sourceText = '';

  /**
   * Indentation seen in the first exploded array of the document, used by
   * default when rewriting (root table only).
   */
  indentHint = '';

  get(key: string): KV | undefined {
    return this.index.get(key);
  }

  has(key: string): boolean {
    return this.index.has(key);
  }

  /** Inserts the entry, or replaces its value keeping its place and layout. */
  set(entry: KV): void {
    const existing = this.index.get(entry.key);
    if (existing) {
      Object.assign(existing, entry);
      return;
    }
    this.index.set(entry.key, entry);
    this.items.push(entry);
    this.dirty = true;
  }

  /** Replaces the value of an existing key without touching its layout. */
  setValue(key: string, val: TomlValue): boolean {
    const existing = this.index.get(key);
    if (!existing) return false;
    if (existing.val !== val) {
      existing.val = val;
      existing.dirty = true;
    }
    return true;
  }

  delete(key: string): boolean {
    if (!this.index.delete(key)) return false;
    const i = this.items.findIndex((kv) => kv.key === key);
    if (i >= 0) this.items.splice(i, 1);
    this.dirty = true;
    return true;
  }

  /** Holds scalars only, the condition for a safe inline rendering. */
  allScalars(): boolean {
    return this.items.every((kv) => {
      if (kv.val.kind === 'table' || kv.val.kind === 'array') return false;
      if (kv.val.kind === 'string' && hasNewline(kv.val.str)) return false;
      return true;
    });
  }
}

/**
 * Creates a table entry with a blank layout. The quoting style of the key is
 * chosen here, so that a faithful rewrite only has to honour it: a numeric key
 * such as `75` gets its quotes to stay readably a string.
 */
export function kv(key: string, val: TomlValue, extra: Partial<KV> = {}): KV {
  return {
    key,
    keyQuote: defaultKeyQuote(key),
    val,
    comments: [],
    blankBefore: 0,
    inlineComment: '',
    inlineCommentPad: 0,
    alignCol: 0,
    indent: '',
    src: null,
    triviaSrc: null,
    dirty: true,
    ...extra,
  };
}

/**
 * Whether no change has touched this value since parsing, in which case its
 * original text can be rewritten as is.
 */
export function isPristine(value: TomlValue): boolean {
  switch (value.kind) {
    case 'table':
      return !value.table.dirty && value.table.items.every((entry) => !entry.dirty && isPristine(entry.val));
    case 'array':
      return !value.dirty && value.items.every(isPristine);
    default:
      return true;
  }
}

/** Marks the whole tree as matching its source, after parsing. */
export function markPristine(table: TomlTable): void {
  table.dirty = false;
  for (const entry of table.items) {
    entry.dirty = false;
    markValuePristine(entry.val);
  }
}

function markValuePristine(value: TomlValue): void {
  if (value.kind === 'table') markPristine(value.table);
  else if (value.kind === 'array') {
    value.dirty = false;
    value.items.forEach(markValuePristine);
  }
}

/** Quotes to give a new key. */
function defaultKeyQuote(key: string): KeyQuote {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? '' : '"';
}

/** An array whose elements are all tables, a candidate for `[[section]]`. */
export function isTableArray(v: TomlValue): boolean {
  return v.kind === 'array' && v.items.length > 0 && v.items.every((i) => i.kind === 'table');
}

export function hasNewline(s: string): boolean {
  return s.includes('\n') || s.includes('\r');
}

/** TOML syntax error, carrying the faulty line. */
export class TomlError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'TomlError';
    this.line = line;
  }
}
