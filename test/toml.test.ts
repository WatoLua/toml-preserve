import {describe, expect, it} from 'vitest';

import {
  applyJS,
  deletePath,
  format,
  getPath,
  hasLayout,
  parse,
  parsePath,
  repair,
  setPath,
  stringify,
  TomlDateTime,
  toJS,
} from '../src/index.js';

import {AFTER_TOML, BEFORE_TOML} from '../src/testing/toml-fixtures.js';

/** Compares while ignoring trailing spaces, which writing strips. */
function sameText(a: string, b: string): boolean {
  const norm = (t: string) => t.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');
  return norm(a) === norm(b);
}

describe('toml', () => {

  describe('parse / stringify', () => {

    it('rewrites a file identically', () => {
      expect(sameText(stringify(parse(BEFORE_TOML)), BEFORE_TOML)).toBe(true);
    });

    it('rewrites an already flattened file identically', () => {
      expect(sameText(stringify(parse(AFTER_TOML)), AFTER_TOML)).toBe(true);
    });

    it('keeps the data of every TOML construct', () => {
      const cases = [
        'a = 1',
        `a = "x"\nb = 'y'`,
        's = """\nligne1\nligne2\n"""',
        "s = '''\nraw \\n left alone\n'''",
        'esc = "guillemet \\" antislash \\\\ tab \\t unicode \\u00e9 \\U0001F600"',
        'cont = """\nune \\\n    suite\n"""',
        'ints = [1, -2, +3, 1_000, 0xdead_beef, 0o755, 0b1010]',
        'floats = [1.5, -0.0, 6.626e-34, inf, -inf, nan]',
        'dates = [1979-05-27, 1979-05-27T07:32:00Z, 1979-05-27 07:32:00.999-07:00, 07:32:00]',
        'empty_arr = []\nempty_tbl = {}',
        'nested = [[1, 2], [3, [4, 5]]]',
        'inline = { a = 1, b = { c = 2 } }',
        'dotted.a.b = 1\ndotted.a.c = 2',
        '"key with spaces" = 1\n\'literal.key\' = 2\n"accented é ü 漢" = 3',
        '[a]\nx = 1\n\n[a.b]\ny = 2\n\n[[a.b.c]]\nz = 3\n\n[[a.b.c]]\nz = 4',
        "[[fruits]]\nname = 'pomme'\n\n[fruits.physical]\ncolor = 'rouge'\n\n[[fruits.varieties]]\nname = 'gala'",
        'bools = [true, false]',
        'q = 75\n"75" = 1.5',
        'multi_in_array = ["a", "b",]',
        'trailing = 1 # commentaire\n# commentaire final',
        'big = 9223372036854775807',
        "tab = [\n\t'a',\n\t'b',\n]",
        'esc_multi = "a\\nb"',
      ];

      for (const src of cases) {
        const doc = parse(src);
        for (const options of [{}, {preserveStyle: false}, {preserveStyle: false, wrapWidth: 20, indent: '\t'}]) {
          const out = stringify(doc, options);
          expect(toJS(parse(out)), `data lost for:\n${src}\n-> ${out}`)
            .toEqual(toJS(doc));
        }
      }
    });

    it('rejects invalid documents', () => {
      const bad = ['a = ', 'a = "ouvert', "a = 'ouvert", 'a = 1\na = 2', '[t]\n[t]',
        'a = [1, 2', 'a = { b = 1', 'a = "\\q"', '= 1', 'a = 1.2.3'];

      for (const src of bad) {
        expect(() => parse(src), `should have failed: ${src}`).toThrow();
      }
    });

    it('reports the faulty line', () => {
      // This message is the one shown to whoever edits a connector configuration.
      expect(() => parse('a = 1\nb = 2\nc = [\n')).toThrow(/line 3/);
    });
  });

  describe('format', () => {

    it('restores sections from an inline array of tables', () => {
      const out = format("configs = [\n\t{ name = 'a', sub.x = 1 },\n\t{ name = 'b', sub.x = 2 },\n]\n");

      expect(out.match(/\[\[configs\]\]/g)?.length).toBe(2);
      expect(out).toMatch(/sub = \{ x = 1 \}/);
    });

    it('makes multiline strings readable', () => {
      expect(format('q = "{\\n  \\"a\\": 1\\n}\\n"')).toBe('q = \'\'\'\n{\n  "a": 1\n}\n\'\'\'\n');
    });

    it('quotes numeric keys', () => {
      expect(format('thresholds.75 = 75.0')).toMatch(/"75" = 75\.0/);
    });

    it('is idempotent', () => {
      const once = format('z = 1\n[b]\nk = 1\n[[a]]\nn = 1\n[[a]]\nn = 2\n');

      expect(format(once)).toBe(once);
    });
  });

  describe('toJS / applyJS', () => {

    it('exposes a plain object JSONPath can work on', () => {
      const obj = toJS(parse(BEFORE_TOML)) as any;

      expect(obj.timezone).toBe('Europe/Paris');
      expect(obj.profiles[0].enabled).toBe(true);
      expect(obj.profiles[0].widths).toEqual(['320', '640']);
      expect(obj.profiles[0].quality_by_width['320']).toBe(75);
    });

    it('rewrites only the lines whose value changed', () => {
      const doc = parse(BEFORE_TOML);
      const obj = toJS(doc) as any;
      obj.profiles[0].max_images_per_batch = 20000;

      const out = stringify(applyJS(doc, obj));

      const source = BEFORE_TOML.split('\n');
      const changed = out.split('\n')
        .filter((line, i) => line.replace(/\s+$/, '') !== source[i]?.replace(/\s+$/, ''));
      expect(changed.length).toBe(1);
      expect(changed[0]).toMatch(/max_images_per_batch = 20000/);
      // The end-of-line comment survives the rewriting of its line.
      expect(changed[0]).toMatch(/# Images handled in a single run/);
    });

    it('keeps the float type when JavaScript hands back an integer', () => {
      // Otherwise a threshold written 75.0 would leave as 60, which the typed connector refuses.
      const doc = parse('seuil = 75.0');
      const obj = toJS(doc) as any;
      obj.seuil = 60;

      expect(stringify(applyJS(doc, obj))).toBe('seuil = 60.0\n');
    });

    it('keeps the original notation when the value did not change', () => {
      const doc = parse('a = 1_000\nb = 0xff\nc = 75.0');

      expect(stringify(applyJS(doc, toJS(doc)))).toBe('a = 1_000\nb = 0xff\nc = 75.0\n');
    });

    it('adds one key and removes another', () => {
      const doc = parse('# tête\na = 1\nb = 2\n');
      const obj = toJS(doc) as any;
      delete obj.b;
      obj.c = 'neuf';

      const out = stringify(applyJS(doc, obj));

      expect(out).toMatch(/# tête/);
      expect(out).not.toMatch(/b = /);
      expect(out).toMatch(/c = "neuf"/);
    });

    it('preserves large integers as bigint', () => {
      const doc = parse('big = 9007199254740993');

      expect(typeof (toJS(doc) as any).big).toBe('bigint');
      expect(stringify(applyJS(doc, toJS(doc)))).toBe('big = 9007199254740993\n');
    });

    it('keeps dates', () => {
      const doc = parse('d = 1979-05-27T07:32:00Z');
      const obj = toJS(doc) as any;

      expect(obj.d instanceof TomlDateTime).toBe(true);
      expect(stringify(applyJS(doc, obj))).toBe('d = 1979-05-27T07:32:00Z\n');
    });

    it('applies the style of the first element to added ones', () => {
      const doc = parse('[[c]]\n# note\nn = 1\n');
      const obj = toJS(doc) as any;
      obj.c.push({n: 2});

      const out = stringify(applyJS(doc, obj));

      expect(out.match(/\[\[c\]\]/g)?.length).toBe(2);
      expect(out.match(/# note/g)?.length).toBe(2);
    });

    it('ignores __proto__', () => {
      const doc = parse('a = 1');

      stringify(applyJS(doc, JSON.parse('{"a": 2, "__proto__": {"polluted": true}}')));

      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('paths', () => {

    it('splits the usual notations', () => {
      expect(parsePath('profiles[0].quality_by_width."640"')).toEqual(['profiles', 0, 'quality_by_width', '640']);
      expect(parsePath("$.profiles[0]['a.b']")).toEqual(['profiles', 0, 'a.b']);
      expect(parsePath('a.b.c')).toEqual(['a', 'b', 'c']);
    });

    it('reads and writes a targeted value', () => {
      const doc = parse(BEFORE_TOML);

      expect(getPath(doc, 'profiles[0].quality_by_width."640"') as number).toBe(75);

      setPath(doc, 'profiles[0].quality_by_width."640"', 60);
      const out = stringify(doc);

      expect(out).toMatch(/"640" = 60\.0 {2}# Medium/);
      expect(sameText(out.replace('"640" = 60.0', '"640" = 75.0'), BEFORE_TOML)).toBe(true);
    });

    it('deletes by path', () => {
      const doc = parse(BEFORE_TOML);

      expect(deletePath(doc, 'profiles[0].target_bucket')).toBe(true);
      expect(deletePath(doc, 'profiles[0].missing_key')).toBe(false);
      expect(stringify(doc)).not.toMatch(/target_bucket/);
    });

    it('refuses an inconsistent path', () => {
      expect(() => setPath(parse('a = 1'), 'a.b', 1)).toThrow();
      expect(() => parsePath('a[x]')).toThrow();
    });
  });

  describe('repair', () => {

    it('gives the flattened file the formatting of the model', () => {
      expect(sameText(repair(AFTER_TOML, BEFORE_TOML), BEFORE_TOML)).toBe(true);
    });

    it('takes the values of the source, never those of the model', () => {
      const out = repair('a = 9\n', '# note\na = 1\n');

      expect(out).toMatch(/# note/);
      expect(out).toMatch(/a = 9/);
    });

    it('keeps an added key and removes a vanished one', () => {
      const out = repair('a = 1\nc = 3\n', 'a = 1\nb = 2\n');

      expect(out).not.toMatch(/b = /);
      expect(out).toMatch(/c = 3/);
    });
  });

  describe('hasLayout', () => {

    it('recognises a formatted file', () => {
      expect(hasLayout(parse(BEFORE_TOML))).toBe(true);
    });

    it('sees no formatting in what a value-only encoder produces', () => {
      expect(hasLayout(parse(AFTER_TOML))).toBe(false);
    });

    it('catches each mark of presentation taken on its own', () => {
      const withLayout = [
        '# a comment\na = 1',
        'a = 1 # at the end of a line',
        'a = 1\n# at the end of a file',
        '[section]\na = 1',
        '[[array]]\na = 1',
        "q = '''\nover two\nlines\n'''",
        'q = """\nover two\nlines\n"""',
        '[parent]\n# commented deep down\na = 1',
        'list = [{ q = \'\'\'\nmultiline\n\'\'\' }]',
      ];

      for (const src of withLayout) {
        expect(hasLayout(parse(src)), `should carry a formatting: ${src}`).toBe(true);
      }
    });

    it('does not take for presentation what is none', () => {
      const bare = [
        'a = 1\nb = 2',
        'a = "text"',
        'list = [1, 2, 3]',
        'table = { a = 1, b = 2 }',
        'dotted.a.b = 1',
        'a = 1\n\nb = 2',
        'aligned  = 1\nb        = 2',
        '',
      ];

      for (const src of bare) {
        expect(hasLayout(parse(src)), `should carry nothing: ${src}`).toBe(false);
      }
    });
  });

  describe('editing through JSONPath', () => {

    it('leaves the file untouched outside the values it changes', () => {
      const doc = parse(BEFORE_TOML);
      const obj = toJS(doc) as any;

      // What an edit through JSONPath does to the decoded object.
      obj.profiles[0].quality_by_width['640'] = 60;
      obj.profiles[0].quality_by_width['1280'] = 50.5;
      obj.profiles[0].max_images_per_batch = 20000;
      obj.profiles[0].widths.push('1280');
      delete obj.profiles[0].target_bucket;

      const out = stringify(applyJS(doc, obj));

      for (const expected of [
        '# === JPEG quality per width ===',
        '# IMPORTANT: this section must stay LAST in the file',
        '[profiles.quality_by_width]',
        '"320" = 75.0  # Small: 75% quality',
        '"640" = 60.0  # Medium: 75% quality',
        '"1280" = 50.5',
        'widths = ["320", "640", "1280"]',
        'source_bucket             = "media-uploads-raw"',
      ]) {
        expect(out, `missing from the result: ${expected}`).toContain(expected);
      }
      expect(out).not.toMatch(/target_bucket/);
      // The multiline query stays a readable literal, not a line full of \n.
      expect(out).toMatch(/pipeline = '''\n\{\n {2}"version": 2,/);
      expect((toJS(parse(out)) as any).profiles[0].quality_by_width['640']).toBe(60);
    });
  });
});
