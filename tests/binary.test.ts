import { isAbsolute } from "node:path";
import { describe, expect, test } from "vitest";
import { MISSING, resolveBinary } from "../src/binary";

describe("resolveBinary", () => {
    test("resolves a present binary to an absolute path", () => {
        const resolved = resolveBinary("sh");

        expect(resolved).not.toBe(MISSING);
        expect(isAbsolute(resolved)).toBe(true);
    });

    test("reports missing for a binary that is not on PATH", () => {
        expect(resolveBinary("pi-search-tools-definitely-not-a-real-binary")).toBe(MISSING);
    });
});
