import { spawnSync } from "node:child_process";
import { type Static, Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MISSING } from "./binary";
import { formatCapped } from "./format";
import type { SearchToolDetails } from "./types";

export const FdSchema = Type.Object({
    pattern: Type.String({ description: "Regex matched against the filename." }),
    path: Type.Optional(Type.String({ description: "Directory to search. Defaults to the current working directory." })),
    entryType: Type.Optional(
        StringEnum(["f", "d", "l", "x"] as const, {
            description: "Filter by entry type: f=file, d=directory, l=symlink, x=executable.",
        }),
    ),
    extension: Type.Optional(Type.String({ description: "Filter by file extension (without leading dot)." })),
    hidden: Type.Optional(Type.Boolean({ description: "Include hidden files. Default false." })),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, description: "Max results (default 500, hard cap 5000)." })),
});

export type FdParams = Static<typeof FdSchema>;

const DEFAULT_MAX_RESULTS = 500;
const MAX_RESULTS_CAP = 5000;
const STDERR_CAP_BYTES = 4096;

const ENTRY_TYPE_MAP: Record<string, string> = {
    f: "file",
    d: "directory",
    l: "symlink",
    x: "executable",
};

export function mapEntryType(entryType: string): string {
    return ENTRY_TYPE_MAP[entryType] ?? entryType;
}

export interface FdRunOptions {
    cwd: string;
    spillId: string;
    /** Test-only cap override forwarded to formatCapped. */
    capBytes?: number;
    /** Test-only spill directory override forwarded to formatCapped. */
    spillDir?: string;
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
        "fd binary not found on PATH. Install with: brew install fd (macOS) " +
        "or apt-get install fd-find (Debian/Ubuntu). Auto-install is intentionally not provided.",
    );
}

function throwFdFailed(stderr: string, err?: Error): never {
    const stderrTrimmed = trimBytes((stderr ?? "").trim(), STDERR_CAP_BYTES);
    const detail = err ? `${err.message}${stderrTrimmed ? "\n" + stderrTrimmed : ""}` : stderrTrimmed || "unknown error";
    throw new Error(`fd failed: ${detail}`);
}

function buildArgs(params: FdParams, maxResults: number): string[] {
    const args = ["--color", "never", "--max-results", String(maxResults)];
    if (params.entryType) {
        args.push("--type", mapEntryType(params.entryType));
    }
    if (params.extension) {
        args.push("--extension", params.extension);
    }
    if (params.hidden) {
        args.push("--hidden");
    }
    // `--` guards against a `-`-prefixed pattern or path being parsed as a flag.
    args.push("--", params.pattern);
    if (params.path) {
        args.push(params.path);
    }
    return args;
}

export function runFd(
    binaryPath: string,
    params: FdParams,
    options: FdRunOptions,
): AgentToolResult<SearchToolDetails> {
    if (binaryPath === MISSING) {
        throwMissing();
    }

    const maxResults = Math.min(params.maxResults ?? DEFAULT_MAX_RESULTS, MAX_RESULTS_CAP);

    const result = spawnSync(binaryPath, buildArgs(params, maxResults), {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });

    // fd: 0 = ok, 1 or 2 = error.
    if (result.error || result.status === 1 || result.status === 2) {
        throwFdFailed(result.stderr ?? "", result.error);
    }

    const lines = (result.stdout ?? "").split("\n").filter(line => line.length > 0);
    const matchCount = lines.length;

    const formatted = formatCapped({
        headerPrefix: `${matchCount} matches in ${matchCount} files`,
        lines,
        tool: "fd",
        spillId: options.spillId,
        capBytes: options.capBytes,
        spillDir: options.spillDir,
    });

    return {
        content: [{ type: "text", text: formatted.text }],
        details: {
            matchCount,
            filesMatched: matchCount,
            truncated: formatted.truncated,
            fullOutputPath: formatted.fullOutputPath,
            binarySource: binaryPath,
        },
    };
}

export function createFdTool(binaryPath: string): ToolDefinition<typeof FdSchema, SearchToolDetails> {
    return {
        name: "fd",
        label: "Fd File Search",
        description:
            "Fast filename search (fd). Returns one path per line. Rendered output is hard-capped at 16 KB; " +
            "the full result spills to a temp file when it overflows.",
        promptGuidelines: [
            "Prefer the `fd` tool over `bash find` / `bash ls` for finding files by name. Regex matches " +
            "against the filename by default; pass a plain substring for literal-style matching. " +
            "`entryType` filters to file / directory / symlink / executable.",
        ],
        parameters: FdSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
            return runFd(binaryPath, params, {
                cwd: ctx.cwd,
                spillId: ctx.sessionManager?.getSessionId?.() ?? String(Date.now()),
            });
        },
    };
}
