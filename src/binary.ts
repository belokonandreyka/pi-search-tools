import { spawnSync } from "node:child_process";

/** Sentinel used when a binary cannot be resolved on PATH. */
export const MISSING = "missing";

/**
 * Resolve an executable's absolute path via `which`. Returns MISSING when the
 * binary is not on PATH. spawnSync (not execFileSync) is used so a non-zero
 * exit is a plain status code rather than a thrown error.
 */
export function resolveBinary(name: string): string {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0 && typeof result.stdout === "string") {
        const resolved = result.stdout.trim();
        if (resolved.length > 0) {
            return resolved;
        }
    }
    return MISSING;
}
