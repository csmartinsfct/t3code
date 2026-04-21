import type { ConfigEnv, UserConfig, UserConfigExport } from "vite";

export const resolveConfigExport = async (
  config: UserConfigExport,
  env: ConfigEnv,
): Promise<UserConfig> => {
  const resolved = typeof config === "function" ? config(env) : config;
  return await Promise.resolve(resolved);
};
