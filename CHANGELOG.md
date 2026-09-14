# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-14

First public release.

### Added

- `parse` and `stringify`, keeping comments, key order, blank lines, indentation,
  the column of aligned `=` signs, string style and number notation. Every entry
  remembers its span in the parsed text, so an untouched document is rewritten
  byte for byte and only changed values are recomposed.
- `toJS` and `applyJS`, to edit a document through a plain JavaScript object and
  feed the changes back without losing the layout — the path to take when a
  JSONPath library is already in use.
- `getPath`, `setPath` and `deletePath`, to reach a single value by path,
  accepting `profiles[0].quality_by_width."640"`, the bracket notation and a
  JSONPath-style `$.` prefix.
- `repair`, giving a flattened file the presentation of a model, and `format`,
  reformatting without one.
- `hasLayout`, telling a file that carries its own presentation from one holding
  only values, so a model is applied only where it is needed.
- Number types survive the trip through JavaScript: a float written `75.0` stays
  a float when set to `60`, notations such as `1_000` and `0xff` are kept when
  the value does not change, and integers beyond the safe range become `bigint`
  rather than lose precision.
- `TomlDateTime`, keeping the written form of dates and times that `Date` cannot
  represent.
- Test fixtures published under `@watolua/toml/testing`.

[unreleased]: https://github.com/WatoLua/toml-preserve/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/WatoLua/toml-preserve/releases/tag/v1.0.0
