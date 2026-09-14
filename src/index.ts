/**
 * Reads and writes TOML without losing its formatting.
 *
 * Decoding a TOML document into a JavaScript object keeps its values and nothing
 * else: comments, key order, indentation and alignment live in the text, not in
 * the object. Parsing here produces a tree carrying the presentation alongside
 * the values, so rewriting an untouched document returns it byte for byte, and
 * only the values that actually changed are recomposed.
 *
 * Two ways to edit a document:
 *
 * ```ts
 * // 1. By path, on the document itself.
 * const doc = parse(text);
 * setPath(doc, 'profiles[0].quality_by_width."640"', 60);
 * const out = stringify(doc);
 *
 * // 2. Through a JavaScript object, to keep using an existing JSONPath library.
 * const doc = parse(text);
 * const obj = toJS(doc);
 * jsonpath.value(obj, '$.profiles[0].quality_by_width["640"]', 60);
 * const out = stringify(applyJS(doc, obj));
 * ```
 */

export { TomlError, TomlTable, isTableArray, kv } from './ast.js';
export type { KV, KeyQuote, StringStyle, TomlValue } from './ast.js';

export { parse } from './parse.js';
export { stringify } from './stringify.js';
export type { StringifyOptions } from './stringify.js';

export { TomlDateTime, applyJS, fromJS, toJS } from './js.js';
export type { JsValue } from './js.js';

export { deletePath, getValue, parsePath, setPath } from './path.js';
export type { PathSegment } from './path.js';

export { format, getPath, repair } from './api.js';

export { hasLayout } from './layout.js';
