# pi-search-tools

A [pi](https://github.com/earendil-works/pi) extension that registers two search tools —
`rg` (ripgrep content search) and `fd` (filename search) — with a hard byte-cap on the
rendered output and automatic spill-to-file for anything that overflows.

Both tools shell out to the real `rg` / `fd` binaries. They do **not** auto-download or
install anything; if a binary is missing the tool returns a clear install hint instead
of failing the session.

## Prerequisites

```sh
brew install ripgrep fd            # macOS
# Debian/Ubuntu: apt-get install ripgrep fd-find
```

Binaries are resolved once at extension init via `which`. The resolved absolute path
(or `"missing"`) is reported as `details.binarySource`.

## `rg` — content search

| Param           | Type       | Default | Notes                                                        |
|-----------------|------------|---------|--------------------------------------------------------------|
| `pattern`       | string     | —       | Regex to search for (required).                              |
| `path`          | string     | cwd     | Directory or file to search.                                 |
| `globs`         | string[]   | —       | Glob filters, forwarded as repeated `--glob`.                |
| `caseSensitive` | boolean    | `false` | `false` uses ripgrep smart-case; `true` forces `-s`.         |
| `literal`       | boolean    | `false` | `true` passes `-F` (fixed-string, no regex).                 |
| `contextLines`  | int 0..3   | `0`     | Lines of context around each match (`--context`).            |
| `maxMatches`    | int 1..1000| `200`   | Max matches to render; true count is still reported. See note below.[^rg-lines] |

Output lines are `path:line:col: text`; context lines use ripgrep's `path-line-  text`
convention.

[^rg-lines]: `matchCount` counts matching **lines** (ripgrep emits one `match` event per line), not individual regex hits within a line.

## `fd` — filename search

| Param        | Type            | Default | Notes                                                 |
|--------------|-----------------|---------|-------------------------------------------------------|
| `pattern`    | string          | —       | Regex matched against the filename (required).        |
| `path`       | string          | cwd     | Directory to search.                                  |
| `entryType`  | `f\|d\|l\|x`    | —       | file / directory / symlink / executable.              |
| `extension`  | string          | —       | Extension filter, without the leading dot.            |
| `hidden`     | boolean         | `false` | Include hidden files (`--hidden`).                    |
| `maxResults` | int 1..5000     | `500`   | Max results (`--max-results`). See note below.[^fd-cap] |

> Note: the param is `entryType`, **not** `type`, to avoid colliding with the subagent
> `type` parameter elsewhere in pi.

Output is one path per line.

[^fd-cap]: This is a **search-cap** (passed as `--max-results`), NOT a render-cap; fd's `matchCount` is therefore bounded by `maxResults` and cannot signal "there were more" — asymmetric with rg's `maxMatches`. See TODO.md for planned alignment.

## Result shape

```jsonc
{
  "content": [{ "type": "text", "text": "<header + lines + optional footer>" }],
  "details": {
    "matchCount": 12,          // TRUE count from the tool, not the rendered count
    "filesMatched": 3,         // equals matchCount for fd
    "truncated": false,
    "fullOutputPath": "…",     // present only when truncated
    "binarySource": "/opt/homebrew/bin/rg"
  }
}
```

Header: `<matchCount> matches in <filesMatched> files (truncated: yes|no)`.
Footer (only when truncated): `... spilled to <fullOutputPath>`.

## Cap semantics

- The rendered text portion of `content[0].text` is hard-capped at **16 KB**
  (`TAIL_HARD_CAP_BYTES`, UTF-8 bytes).
- On overflow: the output is truncated on line boundaries (never mid-line, always at
  least the header), `truncated` is set, the **full** formatted output (all matches) is
  written to `${TMPDIR:-/tmp}/pi-search-tools/<session>-<tool>-<n>.txt` (the trailing
  `<n>` is a per-process counter that keeps consecutive spills from the same session
  distinct), and the footer is appended. The in-band header reads `(truncated: yes)`;
  the spill file's own header reads `(truncated: no)` because the file itself is
  complete.
- The cap is a code constant, not a setting — deliberately, so it is reviewed after we
  have practice with real usage.

## Errors

On failure (invalid regex, missing path, binary missing, non-zero exit) the tool
**throws** with a concise message including the tool name and stderr
(`rg failed: <stderr>` / `fd failed: <stderr>`). Successful zero-match runs return
`0 matches in 0 files`. pi surfaces the throw as an `isError: true` tool result to
the model.

Both tools declare `promptGuidelines` so the default system prompt nudges the model
to pick them over `bash rg` / `bash grep` / `bash find` / `bash ls`.

## Install

Add the package to your pi `settings.json` `packages` list:

```jsonc
{
  "packages": ["pi-search-tools"]
}
```

Or point directly at a local checkout during development:

```jsonc
{
  "extensions": ["/absolute/path/to/pi-search-tools/index.ts"]
}
```

## Development

```sh
npm install
npm run check-types   # tsc --noEmit
npm test              # vitest run
```

Real-binary tests are skipped automatically (`describe.skipIf`) when `rg` / `fd` are not
on PATH.
