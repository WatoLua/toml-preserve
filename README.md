# @watolua/toml

Read and write TOML without losing its formatting.

[Try it live](https://watolua.github.io/toml-preserve/) &middot;
[npm](https://www.npmjs.com/package/@watolua/toml)

Decoding a TOML document into a JavaScript object keeps its values and nothing
else: comments, key order, indentation and alignment live in the text, not in the
object. Parsing here produces a tree carrying the presentation alongside the
values, so rewriting an untouched document returns it byte for byte, and only the
values that actually changed are recomposed.

```sh
npm install @watolua/toml
```

## Round trip

```ts
import {parse, stringify} from '@watolua/toml';

stringify(parse(text)) === text; // comments, alignment and key order included
```

## Editing

Two ways to change a value:

```ts
import {parse, setPath, stringify} from '@watolua/toml';

// 1. By path, on the document itself.
const doc = parse(text);
setPath(doc, 'profiles[0].quality_by_width."640"', 60);
const out = stringify(doc);
```

```ts
import {applyJS, parse, stringify, toJS} from '@watolua/toml';
import jsonpath from 'jsonpath';

// 2. Through a JavaScript object, to keep using an existing JSONPath library.
const doc = parse(text);
const obj = toJS(doc);
jsonpath.value(obj, '$.profiles[0].quality_by_width["640"]', 60);
const out = stringify(applyJS(doc, obj));
```

## Giving formatting back

A document that already lost its presentation — encoded by a writer that emits
values alone — can borrow one from a model. Values always come from the first
argument; the model never supplies data.

```ts
import {hasLayout, parse, repair} from '@watolua/toml';

if (!hasLayout(parse(flattened))) {
  flattened = repair(flattened, wellFormattedModel);
}
```

`format(text)` lays out a flattened document on its own — arrays of tables as
`[[sections]]`, readable multiline strings, short arrays on one line — but cannot
invent comments the text does not carry.

## API

| Export | Role |
| --- | --- |
| `parse(text)` | TOML text to a `TomlTable` carrying values and presentation |
| `stringify(doc, options?)` | back to text; `preserveStyle: false` re-lays it out |
| `toJS(doc)` / `fromJS(value)` / `applyJS(doc, value)` | conversion to and from plain JavaScript |
| `getPath` / `setPath` / `deletePath` / `getValue` / `parsePath` | addressing by `a.b[0]."quoted"` path |
| `format(text, options?)` | re-lay out a document |
| `repair(text, template, options?)` | give a flattened document the model's presentation |
| `hasLayout(doc)` | whether the document carries a presentation worth keeping |
| `TomlDateTime` | a TOML date, time or offset date-time |
| `TomlError` | parse and path failures, with a `line` |

Types (`TomlValue`, `KV`, `JsValue`, `StringifyOptions`, `PathSegment`, …) ship
with the package.

Test fixtures used by the suite are published separately, for consumers that want
to exercise their own round trips:

```ts
import {AFTER_TOML, BEFORE_TOML} from '@watolua/toml/testing';
```

## Demo

[watolua.github.io/toml-preserve](https://watolua.github.io/toml-preserve/) runs the published
package unbundled: the page imports the same `dist/` files `npm install`
delivers, so what you try there is what you get.

To run it locally:

```sh
npm run demo:serve   # builds, then serves demo/ on http://localhost:8080
```

The page needs to be served over http, not opened as a `file://` URL, because it
loads the library as ES modules.

## License

MIT
