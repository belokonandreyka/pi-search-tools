import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MISSING, resolveBinary } from "../src/binary";
import { mapEntryType, runFd } from "../src/fd";

const fdPath = resolveBinary("fd");
const fdAvailable = fdPath !== MISSING;

let fixtureDir: string;
let spillDir: string;

beforeAll(() => {
    fixtureDir = fs.mkdtempSync(join(os.tmpdir(), "pi-search-fd-"));
    spillDir = fs.mkdtempSync(join(os.tmpdir(), "pi-search-fd-spill-"));
    fs.writeFileSync(join(fixtureDir, "alpha.txt"), "a\n");
    fs.writeFileSync(join(fixtureDir, "beta.md"), "b\n");
    fs.mkdirSync(join(fixtureDir, "nested-dir"));
    fs.writeFileSync(join(fixtureDir, "nested-dir", "gamma.txt"), "c\n");
});

afterAll(() => {
    if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
    if (spillDir) fs.rmSync(spillDir, { recursive: true, force: true });
});

function run(params: Parameters<typeof runFd>[1]) {
    return runFd(fdPath, params, { cwd: fixtureDir, spillId: "test", spillDir });
}

describe("mapEntryType", () => {
    test("maps single-letter entry types to fd type names", () => {
        expect(mapEntryType("f")).toBe("file");
        expect(mapEntryType("d")).toBe("directory");
        expect(mapEntryType("l")).toBe("symlink");
        expect(mapEntryType("x")).toBe("executable");
    });
});

describe.skipIf(!fdAvailable)("runFd (real fd binary)", () => {
    test("happy path lists matching paths with accurate counts", () => {
        const result = run({ pattern: "gamma" });

        expect(result.details.matchCount).toBe(1);
        expect(result.details.filesMatched).toBe(1);
        expect(result.details.binarySource).toBe(fdPath);
        expect((result.content[0] as { text: string }).text).toContain("gamma.txt");
        expect((result.content[0] as { text: string }).text.startsWith("1 matches in 1 files (truncated: no)")).toBe(true);
    });

    test("entryType filters to directories only", () => {
        const result = run({ pattern: "nested", entryType: "d" });

        expect(result.details.matchCount).toBe(1);
        expect((result.content[0] as { text: string }).text).toContain("nested-dir");
    });

    test("extension filter restricts results", () => {
        const result = run({ pattern: ".", extension: "md" });

        expect(result.details.matchCount).toBe(1);
        expect((result.content[0] as { text: string }).text).toContain("beta.md");
    });

    test("no matches yields a zero-count header", () => {
        const result = run({ pattern: "zzz_no_such_file_zzz" });

        expect(result.details.matchCount).toBe(0);
        expect((result.content[0] as { text: string }).text).toBe("0 matches in 0 files (truncated: no)");
    });
});

describe.skipIf(!fdAvailable)("runFd error handling / argv safety", () => {
    test("nonexistent search path throws", () => {
        const missing = join(os.tmpdir(), `pi-search-does-not-exist-${Date.now()}-${Math.random()}`);
        expect(() =>
            runFd(fdPath, { pattern: "anything", path: missing }, { cwd: fixtureDir, spillId: "missing-path", spillDir }),
        ).toThrow(/fd failed/i);
    });

    test("a `-`-prefixed pattern is not parsed as a flag", () => {
        // With the `--` guard, fd treats "-foo" as a regex (which is valid) and
        // simply finds no matches — importantly it does NOT crash with a
        // "unknown option" error.
        const result = run({ pattern: "-foo" });
        expect(result.details.matchCount).toBe(0);
    });
});

if (!fdAvailable) {
    describe("runFd (binary missing)", () => {
        test("skipped: fd not available on PATH", () => {
            expect(fdAvailable).toBe(false);
        });
    });
}
