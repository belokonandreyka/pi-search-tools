import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MISSING, resolveBinary } from "../src/binary";
import { runRg } from "../src/rg";

const rgPath = resolveBinary("rg");
const rgAvailable = rgPath !== MISSING;

let fixtureDir: string;
let spillDir: string;

beforeAll(() => {
    fixtureDir = fs.mkdtempSync(join(os.tmpdir(), "pi-search-rg-"));
    spillDir = fs.mkdtempSync(join(os.tmpdir(), "pi-search-rg-spill-"));
    fs.writeFileSync(join(fixtureDir, "one.txt"), "hello world\nsecond line\n");
    fs.writeFileSync(join(fixtureDir, "two.txt"), "another hello here\n");
    fs.writeFileSync(join(fixtureDir, "literal.txt"), "value a.b end\nvalue axb end\n");
    fs.writeFileSync(join(fixtureDir, "context.txt"), "before line\ntarget line\nafter line\n");
    // 12 identical matches on separate lines for the true-count test.
    fs.writeFileSync(join(fixtureDir, "many.txt"), Array(12).fill("needle").join("\n") + "\n");
});

afterAll(() => {
    if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
    if (spillDir) fs.rmSync(spillDir, { recursive: true, force: true });
});

function run(params: Parameters<typeof runRg>[1]) {
    return runRg(rgPath, params, { cwd: fixtureDir, spillId: "test", spillDir });
}

describe.skipIf(!rgAvailable)("runRg (real ripgrep binary)", () => {
    test("happy path returns path:line:col lines and accurate counts", () => {
        const result = run({ pattern: "hello" });

        expect(result.details.matchCount).toBe(2);
        expect(result.details.filesMatched).toBe(2);
        expect(result.details.truncated).toBe(false);
        expect(result.details.binarySource).toBe(rgPath);
        expect(result.content[0]?.type).toBe("text");
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain("one.txt:1:1: hello world");
        expect(text.startsWith("2 matches in 2 files (truncated: no)")).toBe(true);
    });

    test("literal flag disables regex interpretation", () => {
        const regexResult = run({ pattern: "a.b" });
        expect(regexResult.details.matchCount).toBe(2);

        const literalResult = run({ pattern: "a.b", literal: true });
        expect(literalResult.details.matchCount).toBe(1);
        expect((literalResult.content[0] as { text: string }).text).toContain("a.b end");
    });

    test("no matches yields a zero-count header", () => {
        const result = run({ pattern: "zzz_no_such_pattern_zzz" });

        expect(result.details.matchCount).toBe(0);
        expect(result.details.filesMatched).toBe(0);
        expect((result.content[0] as { text: string }).text).toBe("0 matches in 0 files (truncated: no)");
    });

    test("contextLines forwards --context and renders context lines", () => {
        const result = run({ pattern: "target", contextLines: 1 });
        const text = (result.content[0] as { text: string }).text;

        expect(result.details.matchCount).toBe(1);
        expect(text).toContain("context.txt:2:1: target line");
        expect(text).toContain("context.txt-1-  before line");
        expect(text).toContain("context.txt-3-  after line");
    });
});

describe.skipIf(!rgAvailable)("runRg error handling / argv safety", () => {
    test("invalid regex throws with a descriptive message", () => {
        expect(() => run({ pattern: "(" })).toThrow(/rg failed/i);
    });

    test("a `-`-prefixed pattern is not parsed as a flag", () => {
        // With the `--` guard, rg treats "-foo" as a regex (which is valid) and
        // simply finds no matches — importantly it does NOT crash with an
        // "unrecognized option" error.
        const result = run({ pattern: "-foo" });
        expect(result.details.matchCount).toBe(0);
    });

    test("nonexistent search path throws", () => {
        const missing = join(os.tmpdir(), `pi-search-does-not-exist-${Date.now()}-${Math.random()}`);
        expect(() =>
            runRg(rgPath, { pattern: "anything", path: missing }, { cwd: fixtureDir, spillId: "test", spillDir }),
        ).toThrow(/rg failed/i);
    });

    test("matchCount reports the TRUE total even when render cap is smaller", () => {
        const result = runRg(
            rgPath,
            { pattern: "needle", maxMatches: 5 },
            { cwd: fixtureDir, spillId: "true-count", spillDir },
        );
        expect(result.details.matchCount).toBe(12);
        const text = (result.content[0] as { text: string }).text;
        const renderedLines = text.split("\n");
        // header + at most 5 rendered match lines
        expect(renderedLines.length).toBeLessThanOrEqual(6);
        expect(text.startsWith("12 matches in 1 files")).toBe(true);
    });
});

if (!rgAvailable) {
    describe("runRg (binary missing)", () => {
        test("skipped: ripgrep not available on PATH", () => {
            expect(rgAvailable).toBe(false);
        });
    });
}
