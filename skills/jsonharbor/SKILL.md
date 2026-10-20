---
name: jsonharbor
description: Format, minify, validate, extract JSON Pointer paths, and compare JSON files locally with JSON Harbor while preserving exact numeric text. Use for JSON cleanup and inspection, especially long IDs or duplicate keys; not for JSON5 repair or schema validation.
---

# JSON Harbor

Process the user's JSON locally with the JSON Harbor CLI. Keep numeric tokens such as `9223372036854775807`, `2.370`, `2.3e+500`, and `-0` intact. Do not round-trip the document through native `JSON.parse` / `JSON.stringify`, `eval`, or an ordinary numeric object model.

## Locate the CLI

Prefer an existing `jsonharbor` executable or `node <known-repository>/bin/jsonharbor.mjs`. The project is https://github.com/batype/jsonharbor (MIT, Node.js >=20, zero runtime dependencies). If installation is necessary, use the published package only after confirming its availability in the official registry; otherwise install the tagged GitHub release in a task-local directory:

```sh
npm install --prefix ./jsonharbor-runtime github:batype/jsonharbor#v1.0.0
./jsonharbor-runtime/node_modules/.bin/jsonharbor --version
```

Use normal environment approval rules for installation. The skill does not grant permission to upload files or publish their contents.

## Choose the operation

```sh
jsonharbor validate input.json
jsonharbor format input.json --indent 2 --out pretty.json
jsonharbor format input.json --indent 4 --sort --out sorted.json
jsonharbor minify input.json --out compact.json
jsonharbor get input.json '/projects/0/name' --out extracted.json
jsonharbor diff before.json after.json --json
```

Input can be `-` for stdin. Quote shell paths and pointers safely. Use a separate output file and return its location; do not add `--force` unless replacement of that output is requested. The CLI refuses overwriting the input or its hard/symbolic links. For inline JSON, use a file or literal-safe stdin rather than interpolating untrusted content into shell code.

JSON Pointer uses `/` between segments, `~1` for a slash in a key, and `~0` for a tilde. Empty pointer selects the root; `/` selects an empty-string key. Array indices start at zero and cannot have leading zeros. This is not JSONPath.

Formatting preserves duplicate members and emits a warning on stderr. Report that warning. Extraction rejects a path through an ambiguous duplicate key; diff rejects documents with duplicate keys. Do not silently pick one value or remove members. For invalid JSON, report the line/column and ask for the intended correction only if it is ambiguous; do not invent a repair as part of formatting.

Diff ignores object key order, compares arrays by index, and compares numbers by their original token (`1` differs from `1.0`). Strings compare by decoded value. Exit code 1 means differences were found, not execution failure; 0 means equal and 2 means an error. JSON diff reports contain `before` / `after` as strings containing JSON text. Preserve this representation in any downstream report to avoid numeric precision loss. Report `truncated` when true; the default report limit is 500 changes.

## Verify and deliver

Check command exit status, stderr, and the written artifact. Validate a produced JSON file with the same CLI when further processing could have changed it. Summarize the requested operation and any duplicate-key warning, syntax failure, or truncated comparison; link the output file without copying sensitive content into unrelated services.

Limits: strict UTF-8 JSON, 2 MiB input and transformed output, 128 nested levels, 50000 nodes. BOM, comments and trailing commas are rejected. No JSON5, schema validation, remote fetching, or automatic repair. The local CLI needs no account, network processing, API key, or telemetry.
