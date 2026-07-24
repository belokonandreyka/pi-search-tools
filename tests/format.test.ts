import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { formatCapped } from "../src/format";

const spillDir = fs.mkdtempSync(join(os.tmpdir(), "pi-search-format-"));

afterAll(() => {
    fs.rmSync(spillDir, { recursive: true, force: true });
});

const headerPrefix = "5 matches in 2 files";
const lines = ["a.ts:1:1: foo", "b.ts:2:3: bar", "c.ts:9:4: baz"];
const notTruncated = `${headerPrefix} (truncated: no)\n${lines.join("\n")}`;
const exactBytes = Buffer.byteLength(notTruncated, "utf8");

// A larger dataset so truncation drops lines while header + footer still fit
// comfortably under a realistic cap.
const bigHeader = "60 matches in 60 files";
const bigLines = Array.from({ length: 60 }, (_, i) => `file${i}.ts:${i + 1}:1: match content number ${i}`);
const realisticCap = 400;

describe("formatCapped", () => {
    test("renders full output when exactly at the cap and does not truncate", () => {
        const result = formatCapped({ headerPrefix, lines, tool: "rg", spillId: "at-cap", capBytes: exactBytes, spillDir });

        expect(result.truncated).toBe(false);
        expect(result.fullOutputPath).toBeUndefined();
        expect(result.text).toBe(notTruncated);
        expect(result.text.startsWith(`${headerPrefix} (truncated: no)`)).toBe(true);
        expect(result.text).not.toContain("spilled to");
    });

    test("truncates, spills the full output to a file, and appends a footer when over the cap", () => {
        const result = formatCapped({ headerPrefix: bigHeader, lines: bigLines, tool: "rg", spillId: "over-cap", capBytes: realisticCap, spillDir });

        expect(result.truncated).toBe(true);
        expect(result.fullOutputPath).toBeDefined();
        expect(fs.existsSync(result.fullOutputPath as string)).toBe(true);

        expect(result.text.startsWith(`${bigHeader} (truncated: yes)`)).toBe(true);
        expect(result.text).toContain(`... spilled to ${result.fullOutputPath}`);
        expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(realisticCap);

        const renderedLineCount = result.text.split("\n").length;
        expect(renderedLineCount).toBeLessThan(bigLines.length + 2);

        const spilled = fs.readFileSync(result.fullOutputPath as string, "utf8");
        expect(spilled.startsWith(`${bigHeader} (truncated: no)`)).toBe(true);
        expect(spilled).toContain(bigLines[0]);
        expect(spilled).toContain(bigLines[bigLines.length - 1]);
    });

    test("never renders a partial match line and keeps whole lines only", () => {
        const result = formatCapped({ headerPrefix: bigHeader, lines: bigLines, tool: "rg", spillId: "whole-lines", capBytes: realisticCap, spillDir });

        const withoutFooter = result.text.replace(/\n\.\.\. spilled to .*$/s, "");
        const [, ...rendered] = withoutFooter.split("\n");
        for (const line of rendered) {
            expect(bigLines).toContain(line);
        }
    });

    test("emits only the header when there are no lines", () => {
        const result = formatCapped({ headerPrefix: "0 matches in 0 files", lines: [], tool: "rg", spillId: "empty", spillDir });

        expect(result.truncated).toBe(false);
        expect(result.text).toBe("0 matches in 0 files (truncated: no)");
    });

    test("cap smaller than header + footer keeps the byte invariant and still spills", () => {
        // Header "5 matches in 2 files (truncated: yes)" is 37 bytes; footer
        // "\n... spilled to <path>" cannot fit under a 40-byte cap.
        const result = formatCapped({ headerPrefix, lines, tool: "rg", spillId: "tiny-cap", capBytes: 40, spillDir });

        expect(result.truncated).toBe(true);
        expect(result.fullOutputPath).toBeDefined();
        expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(40);
        expect(fs.existsSync(result.fullOutputPath as string)).toBe(true);
        const spilled = fs.readFileSync(result.fullOutputPath as string, "utf8");
        expect(spilled).toContain(lines[0]);
        expect(spilled).toContain(lines[lines.length - 1]);
    });

    test("consecutive truncated calls with the same spillId + tool produce distinct spill paths", () => {
        const a = formatCapped({ headerPrefix: bigHeader, lines: bigLines, tool: "rg", spillId: "reused", capBytes: realisticCap, spillDir });
        const b = formatCapped({ headerPrefix: bigHeader, lines: bigLines, tool: "rg", spillId: "reused", capBytes: realisticCap, spillDir });

        expect(a.fullOutputPath).toBeDefined();
        expect(b.fullOutputPath).toBeDefined();
        expect(a.fullOutputPath).not.toBe(b.fullOutputPath);
        expect(fs.existsSync(a.fullOutputPath as string)).toBe(true);
        expect(fs.existsSync(b.fullOutputPath as string)).toBe(true);
        for (const p of [a.fullOutputPath, b.fullOutputPath]) {
            const spilled = fs.readFileSync(p as string, "utf8");
            expect(spilled).toContain(bigLines[0]);
            expect(spilled).toContain(bigLines[bigLines.length - 1]);
        }
    });

    test("spill file header reports `truncated: no` (the file itself is complete)", () => {
        const result = formatCapped({ headerPrefix: bigHeader, lines: bigLines, tool: "rg", spillId: "spill-header", capBytes: realisticCap, spillDir });

        expect(result.truncated).toBe(true);
        const spilled = fs.readFileSync(result.fullOutputPath as string, "utf8");
        expect(spilled.startsWith(`${bigHeader} (truncated: no)`)).toBe(true);
    });
});
