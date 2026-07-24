import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveBinary } from "./src/binary";
import { createFdTool } from "./src/fd";
import { createRgTool } from "./src/rg";

export default function (pi: ExtensionAPI): void {
    const rgPath = resolveBinary("rg");
    const fdPath = resolveBinary("fd");

    pi.registerTool(createRgTool(rgPath));
    pi.registerTool(createFdTool(fdPath));
}
