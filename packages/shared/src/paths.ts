import * as nodePath from "node:path";

export type T3StateDirMode = "dev" | "userdata";

export function resolveT3StateDirMode(isDevelopment: boolean): T3StateDirMode {
  return isDevelopment ? "dev" : "userdata";
}

export function resolveT3StateDir(baseDir: string, isDevelopment: boolean): string {
  return nodePath.join(baseDir, resolveT3StateDirMode(isDevelopment));
}
