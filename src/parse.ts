import type { KeyQuote, TomlValue } from './ast.js';
import { TomlError, TomlTable, kv, markPristine } from './ast.js';

/**
 * Parses a TOML document, preserving key order, comments, blank lines and
 * writing style.
 *
 * @throws {TomlError} when the document is invalid.
 */
export function parse(input: string): TomlTable {
  return new Parser(input).parseDocument();
}

const BARE_KEY = /[A-Za-z0-9_-]/;

class Parser {
  private src: string;
  private pos = 0;
  private line = 1;
  private root = new TomlTable();
  private current = this.root;
  /** End of the last key read, before the spaces preceding the `=`. */
  private keyEnd = 0;
  private pendingComments: string[] = [];
  private pendingBlank = 0;
  /** Indentation of the first array element written on its own line. */
  private indentHint = '';
  /** Position just after the newline ending the last entry read. */
  private lastLineEnd = 0;

  constructor(input: string) {
    // A leading UTF-8 BOM does not belong to the document.
    this.src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  }

  parseDocument(): TomlTable {
    for (;;) {
      this.skipTrivia();
      if (this.eof()) break;
      if (this.peek() === '[') this.parseHeader();
      else this.parseKeyValue(this.current);
      this.consumeLineEnd();
    }
    this.root.trailing = this.pendingComments;
    this.root.indentHint = this.indentHint;
    this.root.sourceText = this.src;
    markPristine(this.root);
    return this.root;
  }

  /**
   * Consumes the end of the current line and records its position: that is where
   * the comments belonging to the next entry begin.
   */
  private consumeLineEnd(): void {
    while (!this.eof() && this.peek() !== '\n') this.pos++;
    if (!this.eof()) this.advance();
    this.lastLineEnd = this.pos;
  }

  private fail(message: string, line = this.line): never {
    throw new TomlError(message, line);
  }

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  private advance(): string {
    const c = this.src[this.pos++] ?? '';
    if (c === '\n') this.line++;
    return c;
  }

  private skipSpaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
  }

  /** Consumes blanks, newlines and comments, keeping the latter. */
  private skipTrivia(): void {
    let blankRun = 0;
    // On entry the position is at the end of a content line (except at the start of the
    // file): that first newline does not count as a blank line.
    let sawContent = this.pos > 0 && this.src[this.pos - 1] !== '\n';
    while (!this.eof()) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r') {
        this.pos++;
      } else if (c === '\n') {
        this.advance();
        if (!sawContent) blankRun++;
        sawContent = false;
      } else if (c === '#') {
        this.pendingBlank += blankRun;
        blankRun = 0;
        this.pendingComments.push(this.readComment());
        sawContent = true;
      } else {
        this.pendingBlank += blankRun;
        return;
      }
    }
    this.pendingBlank += blankRun;
  }

  /** Reads a comment up to the end of the line, without its `#`. */
  private readComment(): string {
    this.pos++;
    const start = this.pos;
    while (!this.eof() && this.peek() !== '\n') this.pos++;
    return this.src.slice(start, this.pos).replace(/[ \t\r]+$/, '');
  }

  private takeTrivia(): { comments: string[]; blankBefore: number } {
    const out = { comments: this.pendingComments, blankBefore: this.pendingBlank };
    this.pendingComments = [];
    this.pendingBlank = 0;
    return out;
  }

  /** Reads any end-of-line comment and its spacing. */
  private readInlineComment(): { text: string; pad: number } {
    const start = this.pos;
    this.skipSpaces();
    const pad = this.pos - start;
    if (this.peek() === '#') return { text: this.readComment(), pad };
    return { text: '', pad: 0 };
  }

  /** Handles `[table]` and `[[array of tables]]`. */
  private parseHeader(): void {
    const { comments, blankBefore } = this.takeTrivia();
    const lineStart = this.lineStart();
    const indent = this.src.slice(lineStart, this.pos);
    const triviaSrc = { start: this.lastLineEnd, end: lineStart };
    const headerStart = this.pos;
    this.pos++;
    const isArray = this.peek() === '[';
    if (isArray) this.pos++;

    const { keys, quotes } = this.parseKeyPath();
    this.skipSpaces();
    if (this.peek() !== ']') this.fail("expected ']' to close the header");
    this.pos++;
    if (isArray) {
      if (this.peek() !== ']') this.fail("expected ']]' to close the array header");
      this.pos++;
    }
    const inline = this.readInlineComment();

    const table = this.resolveHeader(keys, quotes, isArray);
    table.comments = comments;
    table.blankBefore = blankBefore;
    table.inlineComment = inline.text;
    table.inlineCommentPad = inline.pad;
    table.implicit = false;
    table.indent = indent;
    table.headerSrc = { start: headerStart, end: this.pos };
    table.triviaSrc = triviaSrc;
    this.current = table;
  }

  /** Walks to the table a header designates, creating it when needed. */
  private resolveHeader(keys: string[], quotes: KeyQuote[], isArray: boolean): TomlTable {
    let cursor = this.root;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const last = i === keys.length - 1;
      const existing = cursor.get(key);

      if (!existing) {
        const child = new TomlTable();
        if (last && isArray) {
          cursor.set(
            kv(key, { kind: 'array', items: [{ kind: 'table', table: child }], multiline: false, ofTables: true }, { keyQuote: quotes[i]! }),
          );
          return child;
        }
        child.implicit = !last;
        cursor.set(kv(key, { kind: 'table', table: child }, { keyQuote: quotes[i]! }));
        cursor = child;
        continue;
      }

      const val = existing.val;
      if (val.kind === 'table') {
        if (last && isArray) this.fail(`"${keys.join('.')}" is a table, not an array of tables`);
        if (last && !val.table.implicit) this.fail(`table "${keys.join('.')}" is defined twice`);
        cursor = val.table;
      } else if (val.kind === 'array' && val.ofTables) {
        if (last && isArray) {
          const child = new TomlTable();
          val.items.push({ kind: 'table', table: child });
          return child;
        }
        // A child header applies to the last element of the array.
        const tail = val.items[val.items.length - 1]!;
        if (tail.kind !== 'table') this.fail(`"${keys.slice(0, i + 1).join('.')}" is not a table`);
        cursor = tail.table;
      } else {
        this.fail(`"${keys.slice(0, i + 1).join('.')}" is not a table`);
      }
    }
    return cursor;
  }

  /** Reads `key[.key...] = value`. */
  private parseKeyValue(dest: TomlTable): void {
    const { comments, blankBefore } = this.takeTrivia();
    const lineStart = this.lineStart();
    const keyStart = this.pos;
    const indent = this.src.slice(lineStart, keyStart);
    const triviaSrc = { start: this.lastLineEnd, end: lineStart };
    const { keys, quotes } = this.parseKeyPath();
    const keyWidth = this.keyEnd - keyStart;
    this.skipSpaces();
    if (this.peek() !== '=') this.fail(`expected '=' after key "${keys.join('.')}"`);
    const eqCol = this.pos - keyStart;
    this.pos++;
    this.skipSpaces();
    const val = this.parseValue();
    const inline = this.readInlineComment();

    const target = this.descendDotted(dest, keys, quotes);
    const leaf = keys[keys.length - 1]!;
    if (target.has(leaf)) this.fail(`key "${keys.join('.')}" is defined twice`);
    target.set(
      kv(leaf, val, {
        keyQuote: quotes[quotes.length - 1]!,
        comments,
        blankBefore,
        inlineComment: inline.text,
        inlineCommentPad: inline.pad,
        alignCol: eqCol > keyWidth ? eqCol : 0,
        indent,
        src: { start: keyStart, end: this.pos },
        triviaSrc,
        dirty: false,
      }),
    );
  }

  /** Creates the intermediate tables of a dotted key `a.b.c = 1`. */
  private descendDotted(dest: TomlTable, keys: string[], quotes: KeyQuote[]): TomlTable {
    let cursor = dest;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      const existing = cursor.get(key);
      if (!existing) {
        const child = new TomlTable();
        child.dotted = true;
        cursor.set(kv(key, { kind: 'table', table: child }, { keyQuote: quotes[i]! }));
        cursor = child;
        continue;
      }
      if (existing.val.kind !== 'table') this.fail(`"${keys.slice(0, i + 1).join('.')}" is not a table`);
      cursor = existing.val.table;
    }
    return cursor;
  }

  private lineStart(): number {
    let i = this.pos;
    while (i > 0 && this.src[i - 1] !== '\n') i--;
    return i;
  }

  private parseKeyPath(): { keys: string[]; quotes: KeyQuote[] } {
    const keys: string[] = [];
    const quotes: KeyQuote[] = [];
    for (;;) {
      this.skipSpaces();
      const [key, quote] = this.parseKeySegment();
      keys.push(key);
      quotes.push(quote);
      this.keyEnd = this.pos;
      this.skipSpaces();
      if (this.peek() !== '.') return { keys, quotes };
      this.pos++;
    }
  }

  private parseKeySegment(): [string, KeyQuote] {
    const c = this.peek();
    if (c === '"') return [this.parseBasicString(), '"'];
    if (c === "'") return [this.parseLiteralString(), "'"];
    const start = this.pos;
    while (!this.eof() && BARE_KEY.test(this.peek())) this.pos++;
    if (this.pos === start) this.fail(`expected a key, found "${c || 'end of file'}"`);
    return [this.src.slice(start, this.pos), ''];
  }

  private parseValue(): TomlValue {
    const c = this.peek();
    if (c === '"') {
      if (this.peek(1) === '"' && this.peek(2) === '"') {
        return { kind: 'string', str: this.parseMultilineBasic(), style: 'multi-basic' };
      }
      return { kind: 'string', str: this.parseBasicString(), style: 'basic' };
    }
    if (c === "'") {
      if (this.peek(1) === "'" && this.peek(2) === "'") {
        return { kind: 'string', str: this.parseMultilineLiteral(), style: 'multi-literal' };
      }
      return { kind: 'string', str: this.parseLiteralString(), style: 'literal' };
    }
    if (c === '[') return this.parseArray();
    if (c === '{') return this.parseInlineTable();
    return this.parseScalar();
  }

  /** Reads a boolean, a number or a date in its raw form. */
  private parseScalar(): TomlValue {
    const start = this.pos;
    while (!this.eof() && !',]}\n#'.includes(this.peek())) this.pos++;
    const raw = this.src.slice(start, this.pos).replace(/[ \t\r]+$/, '');
    if (raw === '') this.fail('expected a value');
    this.pos = start + raw.length;
    if (raw === 'true' || raw === 'false') return { kind: 'boolean', raw };
    const kind = classifyScalar(raw);
    if (!kind) this.fail(`invalid value "${raw}"`);
    return { kind, raw };
  }

  private parseArray(): TomlValue {
    // The opening line locates an array that is never closed better than the end of the
    // file would.
    const openLine = this.line;
    this.pos++;
    const items: TomlValue[] = [];
    let multiline = false;
    for (;;) {
      multiline = this.skipArrayTrivia() || multiline;
      if (this.eof()) this.fail("missing ']': unclosed array", openLine);
      if (this.peek() === ']') {
        this.pos++;
        return { kind: 'array', items, multiline, ofTables: false };
      }
      items.push(this.parseValue());
      multiline = this.skipArrayTrivia() || multiline;
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      if (this.peek() !== ']') this.fail("expected ',' or ']' in array");
    }
  }

  /** Consumes blanks and comments inside an array; reports whether it is exploded. */
  private skipArrayTrivia(): boolean {
    let multiline = false;
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else if (c === '\n') {
        this.advance();
        multiline = true;
        this.captureIndent();
      } else if (c === '#') this.readComment();
      else return multiline;
    }
  }

  /** Records the indentation of the first element placed on its own line. */
  private captureIndent(): void {
    if (this.indentHint !== '') return;
    let i = this.pos;
    while (i < this.src.length && (this.src[i] === ' ' || this.src[i] === '\t')) i++;
    const next = this.src[i];
    if (i > this.pos && next !== undefined && next !== '\n' && next !== '\r' && next !== ']') {
      this.indentHint = this.src.slice(this.pos, i);
    }
  }

  private parseInlineTable(): TomlValue {
    const openLine = this.line;
    this.pos++;
    const table = new TomlTable();
    table.inline = true;
    for (;;) {
      this.skipInlineTrivia();
      if (this.eof()) this.fail("missing '}': unclosed inline table", openLine);
      if (this.peek() === '}') {
        this.pos++;
        return { kind: 'table', table };
      }
      const { keys, quotes } = this.parseKeyPath();
      this.skipSpaces();
      if (this.peek() !== '=') this.fail(`expected '=' in inline table after "${keys.join('.')}"`);
      this.pos++;
      this.skipSpaces();
      const val = this.parseValue();
      const target = this.descendDotted(table, keys, quotes);
      target.set(kv(keys[keys.length - 1]!, val, { keyQuote: quotes[quotes.length - 1]! }));
      this.skipInlineTrivia();
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      if (this.peek() !== '}') this.fail("expected ',' or '}' in inline table");
    }
  }

  /**
   * Tolerates newlines inside an inline table: some JavaScript encoders produce
   * them, and rejecting the file would help nobody.
   */
  private skipInlineTrivia(): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else if (c === '\n') this.advance();
      else if (c === '#') this.readComment();
      else return;
    }
  }

  private parseLiteralString(): string {
    this.pos++;
    const start = this.pos;
    for (;;) {
      if (this.eof() || this.peek() === '\n') this.fail("missing closing apostrophe");
      if (this.peek() === "'") {
        const out = this.src.slice(start, this.pos);
        this.pos++;
        return out;
      }
      this.pos++;
    }
  }

  private parseMultilineLiteral(): string {
    const openLine = this.line;
    this.pos += 3;
    this.skipFirstNewline();
    const start = this.pos;
    for (;;) {
      if (this.eof()) this.fail("missing closing '''", openLine);
      if (this.peek() === "'" && this.peek(1) === "'" && this.peek(2) === "'") {
        let end = this.pos;
        this.pos += 3;
        // Up to two further apostrophes belong to the content.
        for (let i = 0; i < 2 && this.peek() === "'"; i++) {
          end++;
          this.pos++;
        }
        return this.src.slice(start, end);
      }
      this.advance();
    }
  }

  /** A newline immediately after the opening delimiter is ignored. */
  private skipFirstNewline(): void {
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.pos += 2;
      this.line++;
    } else if (this.peek() === '\n') {
      this.advance();
    }
  }

  private parseBasicString(): string {
    this.pos++;
    let out = '';
    for (;;) {
      if (this.eof() || this.peek() === '\n') this.fail('missing closing quote');
      const c = this.advance();
      if (c === '"') return out;
      if (c === '\\') out += this.readEscape(false);
      else out += c;
    }
  }

  private parseMultilineBasic(): string {
    const openLine = this.line;
    this.pos += 3;
    this.skipFirstNewline();
    let out = '';
    for (;;) {
      if (this.eof()) this.fail('missing closing """', openLine);
      if (this.peek() === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
        this.pos += 3;
        for (let i = 0; i < 2 && this.peek() === '"'; i++) {
          out += '"';
          this.pos++;
        }
        return out;
      }
      const c = this.advance();
      if (c === '\\') out += this.readEscape(true);
      else out += c;
    }
  }

  /**
   * Handles an escape sequence. Inside a multiline string, a backslash at the end
   * of a line absorbs the blanks up to the next content.
   */
  private readEscape(multiline: boolean): string {
    if (this.eof()) this.fail('incomplete escape');
    const c = this.advance();
    switch (c) {
      case 'b': return '\b';
      case 't': return '\t';
      case 'n': return '\n';
      case 'f': return '\f';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case 'e': return '\x1b';
      case 'u':
      case 'U': {
        const width = c === 'u' ? 4 : 8;
        const hex = this.src.slice(this.pos, this.pos + width);
        if (hex.length < width || !/^[0-9a-fA-F]+$/.test(hex)) this.fail(`incomplete \\${c} escape`);
        const code = parseInt(hex, 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          this.fail(`invalid Unicode code point U+${hex.toUpperCase()}`);
        }
        this.pos += width;
        return String.fromCodePoint(code);
      }
      case '\r':
      case '\n':
      case ' ':
      case '\t': {
        if (!multiline) this.fail(`invalid escape \\${c}`);
        if (c === ' ' || c === '\t') {
          this.skipSpaces();
          if (this.peek() !== '\n' && !(this.peek() === '\r' && this.peek(1) === '\n')) {
            this.fail(`invalid escape \\${c}`);
          }
        }
        for (;;) {
          const n = this.peek();
          if (n === ' ' || n === '\t' || n === '\r') this.pos++;
          else if (n === '\n') this.advance();
          else return '';
        }
      }
      default:
        this.fail(`unknown escape \\${c}`);
    }
  }
}

/** Tells integer, float and date/time apart from the writing. */
function classifyScalar(raw: string): 'integer' | 'float' | 'datetime' | null {
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(raw) || /^\d{2}:\d{2}(:\d{2})?/.test(raw)) return 'datetime';
  const low = raw.toLowerCase();
  if (/^[+-]?(inf|nan)$/.test(low)) return 'float';
  if (/^[+-]?0(x[0-9a-f_]+|o[0-7_]+|b[01_]+)$/.test(low)) return 'integer';
  if (/^[+-]?(0|[1-9](_?\d)*)$/.test(raw)) return 'integer';
  if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(raw)) return 'float';
  return null;
}
