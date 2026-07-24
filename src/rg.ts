import { spawnSync } from "node:child_process";
import { type Static, Type } from "typebox";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MISSING } from "./binary";
import { formatCapped } from "./format";
import type { SearchToolDetails } from "./types";

export const RgSchema = Type.Object({
    pattern: Type.String({ description: "Regex pattern to search for." }),
    path: Type.Optional(Type.String({ description: "Directory or file to search. Defaults to the current working directory." })),
    globs: Type.Optional(Type.Array(Type.String(), { description: "Glob filters, forwarded as repeated --glob." })),
    caseSensitive: Type.Optional(Type.Boolean({ description: "Force case-sensitive search. Default false uses ripgrep smart-case." })),
    literal: Type.Optional(Type.Boolean({ description: "Treat the pattern as a fixed string (-F), disabling regex. Default false." })),
    contextLines: Type.Optional(Type.Integer({ minimum: 0, maximum: 3, description: "Lines of context around each match (0-3). Default 0." })),
    maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: "Max matches to render (default 200, hard cap 1000)." })),
});

export type RgParams = Static<typeof RgSchema>;

const DEFAULT_MAX_MATCHES = 200;
const MAX_MATCHES_CAP = 1000;
const MAX_CONTEXT_LINES = 3;
const STDERR_CAP_BYTES = 4096;

export interface RgRunOptions {
    cwd: string;
    spillId: string;
    /** Test-only cap override forwarded to formatCapped. */
    capBytes?: number;
    /** Test-only spill directory override forwarded to formatCapped. */
    spillDir?: string;
}

function stripTrailingNewline(value: string): string {
    return value.replace(/\r?\n$/, "");
}

function trimBytes(value: string, cap: number): string {
    const buf = Buffer.from(value, "utf8");
    if (buf.length <= cap) return value;
    let end = cap;
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
    return buf.subarray(0, end).toString("utf8") + "\n... (stderr truncated)";
}

function throwMissing(): never {
    throw new Error(
        "rg binary not found on PATH. Install with: brew install ripgrep (macOS) " +
        "or apt-get install ripgrep (Debian/Ubuntu). Auto-install is intentionally not provided.",
    );
}

function throwRgFailed(stderr: string, err?: Error): never {
    const stderrTrimmed = trimBytes((stderr ?? "").trim(), STDERR_CAP_BYTES);
    const detail = err ? `${err.message}${stderrTrimmed ? "\n" + stderrTrimmed : ""}` : stderrTrimmed || "unknown error";
    throw new Error(`rg failed: ${detail}`);
}

function buildArgs(params: RgParams, contextLines: number): string[] {
    const args = ["--json", "--no-heading", "--color", "never"];
    args.push(params.caseSensitive ? "--case-sensitive" : "--smart-case");
    if (params.literal) {
        args.push("--fixed-strings");
    }
    if (contextLines > 0) {
        args.push("--context", String(contextLines));
    }
    for (const glob of params.globs ?? []) {
        args.push("--glob", glob);
    }
    // Explicit path required: without a TTY on stdin ripgrep reads from stdin
    // instead of searching cwd. `--` prevents a `-`-prefixed pattern from being
    // parsed as a flag.
    args.push("--", params.pattern, params.path ?? ".");
    return args;
}

export function runRg(
    binaryPath: string,
    params: RgParams,
    options: RgRunOptions,
): AgentToolResult<SearchToolDetails> {
    if (binaryPath === MISSING) {
        throwMissing();
    }

    const maxMatches = Math.min(params.maxMatches ?? DEFAULT_MAX_MATCHES, MAX_MATCHES_CAP);
    const contextLines = Math.min(params.contextLines ?? 0, MAX_CONTEXT_LINES);

    const result = spawnSync(binaryPath, buildArgs(params, contextLines), {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });

    // ripgrep: 0 = matches, 1 = no matches (still success), 2 = error.
    if (result.error || result.status === 2) {
        throwRgFailed(result.stderr ?? "", result.error);
    }

    const lines: string[] = [];
    const files = new Set<string>();
    let matchCount = 0;
    let renderedMatches = 0;

    for (const raw of (result.stdout ?? "").split("\n")) {
        if (raw.length === 0) {
            continue;
        }
        const event = JSON.parse(raw) as RipgrepEvent;
        if (event.type === "match") {
            matchCount += 1;
            files.add(event.data.path.text);
            if (renderedMatches < maxMatches) {
                const line = event.data.line_number;
                const col = (event.data.submatches[0]?.start ?? 0) + 1;
                const text = stripTrailingNewline(event.data.lines.text ?? "");
                lines.push(`${event.data.path.text}:${line}:${col}: ${text}`);
                renderedMatches += 1;
            }
        }
        else if (event.type === "context" && renderedMatches < maxMatches) {
            const text = stripTrailingNewline(event.data.lines.text ?? "");
            lines.push(`${event.data.path.text}-${event.data.line_number}-  ${text}`);
        }
    }

    const headerPrefix = `${matchCount} matches in ${files.size} files`;
    const formatted = formatCapped({
        headerPrefix,
        lines,
        tool: "rg",
        spillId: options.spillId,
        capBytes: options.capBytes,
        spillDir: options.spillDir,
    });

    return {
        content: [{ type: "text", text: formatted.text }],
        details: {
            matchCount,
            filesMatched: files.size,
            truncated: formatted.truncated,
            fullOutputPath: formatted.fullOutputPath,
            binarySource: binaryPath,
        },
    };
}

interface RipgrepEvent {
    type: string;
    data: {
        path: { text: string };
        lines: { text?: string };
        line_number: number;
        submatches: { start: number }[];
    };
}

export function createRgTool(binaryPath: string): ToolDefinition<typeof RgSchema, SearchToolDetails> {
    return {
        name: "rg",
        label: "Ripgrep Search",
        description:
            "Fast regex content search (ripgrep). Returns `path:line:col: text` lines. Rendered output is " +
            "hard-capped at 16 KB; the full result spills to a temp file when it overflows.",
        promptGuidelines: [
            "Prefer the `rg` tool over `bash rg` / `bash grep` for searching file contents. It returns " +
            "capped output (16 KB) with true match counts; overflow spills to a temp file whose path " +
            "is in `details.fullOutputPath`. Use `literal: true` for non-regex substring searches.",
        ],
        parameters: RgSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
            return runRg(binaryPath, params, {
                cwd: ctx.cwd,
                spillId: ctx.sessionManager?.getSessionId?.() ?? String(Date.now()),
            });
        },
    };
}
