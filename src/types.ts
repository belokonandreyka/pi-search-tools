/** Structured details returned by both search tools for logs / UI rendering. */
export interface SearchToolDetails {
    /** True total match count from the underlying tool (NOT the rendered count). */
    matchCount: number;
    /** Number of distinct files containing matches (equals matchCount for fd). */
    filesMatched: number;
    /** Whether the rendered text was byte-capped and spilled to a file. */
    truncated: boolean;
    /** Absolute path of the full uncapped output, present only when truncated. */
    fullOutputPath?: string;
    /** Resolved absolute path of the binary used, or "missing". */
    binarySource: string;
}
