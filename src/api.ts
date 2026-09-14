import type { TomlValue } from './ast.js';
import { TomlTable, kv } from './ast.js';
import { applyJS, toJS, type JsValue } from './js.js';
import { parse } from './parse.js';
import { getValue, type PathSegment } from './path.js';
import { stringify, type StringifyOptions } from './stringify.js';

/** Reads the value a path designates, converted to a JavaScript value. */
export function getPath(doc: TomlTable, path: string | PathSegment[]): JsValue | undefined {
  const found = getValue(doc, path);
  if (found === undefined) return undefined;
  if (found.kind === 'table') return toJS(found.table);
  return toJS(singleton(found)).v;
}

/** Wraps a lone value in a table, so the conversion can be reused. */
function singleton(value: TomlValue): TomlTable {
  const holder = new TomlTable();
  holder.set(kv('v', value));
  return holder;
}

/**
 * Lays out a flattened TOML: arrays of tables as `[[sections]]`, readable
 * multiline strings, short arrays on one line.
 *
 * Comments the input text does not carry cannot be invented; to get those back,
 * use {@link repair} with a well formatted version as the model.
 */
export function format(text: string, options: StringifyOptions = {}): string {
  return stringify(parse(text), { preserveStyle: false, ...options });
}

/**
 * Gives a TOML that has lost its formatting the presentation of a model:
 * comments, key order, alignment, and the choice between sections and inline
 * tables.
 *
 * Values always come from `text`; the model never supplies data. A key absent
 * from `text` disappears, a new key is added at the end of its table.
 *
 * Only for a file that already lost its formatting: going through {@link parse}
 * and {@link stringify} never loses it, and needs no model.
 */
export function repair(text: string, template: string, options: StringifyOptions = {}): string {
  const model = parse(template);
  applyJS(model, toJS(parse(text)));
  return stringify(model, options);
}
