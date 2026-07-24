import * as fs from "node:fs";
import { join } from "node:path";

/**
 * Hard cap on the RENDERED text portion of a tool result, in UTF-8 bytes.
 *
 * DELIBERATE: this lives in code, not config. 16 KB keeps a search result well
 * within a single model turn while the full output spills to a temp file. The
 * value will be revisited after we have practice with real usage — do not turn
 * it into a setting without that review.
 */
export const TAIL_HARD_CAP_BYTES = 16_384;

export interface FormatInput {
    /** Count portion of the header, e.g. "12 matches in 3 files". The
     *  "(truncated: yes|no)" suffix is appended here so it always matches the
     *  actual outcome. */
    headerPrefix: string;
    /** Fully rendered lines (the complete, uncapped set). */
    lines: string[];
    /** Tool name, used in the spill filename. */
    tool: string;
    /** Session id or timestamp, used in the spill filename. */
    spillId: string;
    /** Override the byte cap (tests only). */
    capBytes?: number;
    /** Override the spill directory (tests only). */
    spillDir?: string;
}

export interface FormatResult {
    text: string;
    truncated: boolean;
    fullOutputPath?: string;
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

// Per-process monotonic counter to disambiguate spill files when the same
// session emits multiple truncated results for the same tool.
let spillCounter = 0;

function spillPath(tool: string, spillId: string, spillDir?: string): string {
    const dir = spillDir ?? join(process.env.TMPDIR ?? "/tmp", "pi-search-tools");
    fs.mkdirSync(dir, { recursive: true });
    spillCounter += 1;
    return join(dir, `${spillId}-${tool}-${spillCounter}.txt`);
}

/**
 * Render the header + match lines under the byte cap. When the full output
 * would exceed the cap, the complete formatted output is written to a spill
 * file, the header reports "truncated: yes", only whole lines that fit are
 * rendered, and a "... spilled to <path>" footer is appended.
 */
export function formatCapped(input: FormatInput): FormatResult {
    const cap = input.capBytes ?? TAIL_HARD_CAP_BYTES;
    const body = input.lines.length > 0 ? "\n" + input.lines.join("\n") : "";

    const fullNotTruncated = `${input.headerPrefix} (truncated: no)` + body;
    if (byteLength(fullNotTruncated) <= cap) {
        return { text: fullNotTruncated, truncated: false };
    }

    const header = `${input.headerPrefix} (truncated: yes)`;
    const fullOutputPath = spillPath(input.tool, input.spillId, input.spillDir);
    // Spill file contains the complete output, so "truncated: no" is truthful there.
    fs.writeFileSync(fullOutputPath, `${input.headerPrefix} (truncated: no)` + body, "utf8");

    const footer = `\n... spilled to ${fullOutputPath}`;
    const headerBytes = byteLength(header);
    const footerBytes = byteLength(footer);

    // Cap smaller than header + footer: drop the footer entirely and, if needed,
    // truncate the header on a UTF-8 byte boundary so the invariant holds.
    if (headerBytes + footerBytes > cap) {
        if (headerBytes <= cap) {
            return { text: header, truncated: true, fullOutputPath };
        }
        // Header itself exceeds cap: byte-slice, then trim trailing bytes of any
        // partial UTF-8 codepoint so `byteLength(text) <= cap` holds strictly.
        const buf = Buffer.from(header, "utf8");
        let end = cap;
        while (end > 0 && (buf[end] & 0xc0) === 0x80) {
            end -= 1;
        }
        return { text: buf.subarray(0, end).toString("utf8"), truncated: true, fullOutputPath };
    }

    let text = header;
    let used = headerBytes;
    for (const line of input.lines) {
        const addition = byteLength("\n" + line);
        if (used + addition + footerBytes > cap) {
            break;
        }
        text += "\n" + line;
        used += addition;
    }
    text += footer;

    return { text, truncated: true, fullOutputPath };
}
