import type {KV, TomlValue} from './ast.js';
import {TomlTable} from './ast.js';

/**
 * Whether a document carries a formatting of its own, or only its values.
 *
 * Decides whether a file needs a model: one that arrives with its presentation
 * keeps it, one that arrives bare takes the presentation of what it replaces.
 * Taking the model's presentation unconditionally would erase the comments
 * written on the source environment, and comments are the one thing no model can
 * reinvent.
 *
 * Three marks are enough, none of which an encoder writing values alone
 * produces:
 * - a comment, wherever it stands;
 * - a `[table]` or `[[array]]` header, rather than an inline table;
 * - a multiline string, rather than a line of escaped newlines.
 *
 * Doubt favours the incoming file: calling it formatted when it is not costs
 * only a plain layout, whereas the opposite loses comments.
 */
export function hasLayout(doc: TomlTable): boolean {
  return doc.trailing.length > 0 || tableHasLayout(doc);
}

function tableHasLayout(table: TomlTable): boolean {
  if (table.comments.length > 0 || table.inlineComment !== '') {
    return true;
  }
  return table.items.some(entryHasLayout);
}

function entryHasLayout(entry: KV): boolean {
  if (entry.comments.length > 0 || entry.inlineComment !== '') {
    return true;
  }
  return valueHasLayout(entry.val);
}

function valueHasLayout(value: TomlValue): boolean {
  switch (value.kind) {
    case 'string':
      return value.style === 'multi-basic' || value.style === 'multi-literal';
    case 'array':
      return value.items.some(valueHasLayout);
    case 'table':
      // A table written as a section has been laid out; an inline table or one born of
      // dotted keys is what a flattening encoder produces.
      return value.table.headerSrc !== null || tableHasLayout(value.table);
    default:
      return false;
  }
}
