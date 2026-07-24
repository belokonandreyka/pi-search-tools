# TODO

Follow-ups deferred from initial commit. Not gating; open before publishing.

## Test coverage
- Missing-binary throw path: call `runRg(MISSING, ...)` / `runFd(MISSING, ...)` and assert the thrown Error message matches `/not found/`. Currently only `resolveBinary` is asserted.
- Multibyte byte-slice: header-longer-than-cap test with a header made of multibyte UTF-8 (Cyrillic/emoji) longer than cap; assert `byteLength(text) <= cap` and no U+FFFD replacement character in output.
- Untested rg params: `caseSensitive` vs smart-case default, `globs` forwarding.
- Untested fd params: `hidden`, `maxResults`.
- `trimBytes` stderr cap: direct unit test with an oversized stderr fixture.

## Semantic asymmetry
- fd `maxResults` is currently a SEARCH cap via `--max-results`, so fd's `matchCount` is bounded and cannot signal "there were more". rg's `maxMatches` is a RENDER cap only, so rg's `matchCount` preserves the true total. Candidate alignment: drop `--max-results` in fd and post-filter results in Node so `matchCount` stays truthful, at the cost of buffering more fd output. Decide after real usage.

## Correctness nits
- rg `col` is a UTF-8 byte offset (`submatches[0].start + 1`), not a character column. Off for multibyte lines. Documented shortcoming for now.
- `JSON.parse(raw)` in rg output loop is unguarded (AGENTS.md forbids `try`/`catch`). A malformed `rg --json` line would throw a generic error, bypassing the specific "rg failed" shape. In practice rg emits valid JSON per line; edge case only.

## Code shape
- Duplication across `rg.ts` / `fd.ts`: `trimBytes`, throw helpers, `STDERR_CAP_BYTES`, `RunOptions`. Extract to a shared helper module when a third tool lands, not before.

## Runtime rule brush
- `resolveBinary` runs `spawnSync("which")` in the extension factory. SKILL says "no processes in factory". Cheap one-shot with no cleanup; acceptable, but note for future review.
- `AbortSignal` on `execute()` is unused: `runRg` / `runFd` use blocking `spawnSync`, so cancellation is not honored. Migrate to async `spawn` if real cancel semantics become needed.
