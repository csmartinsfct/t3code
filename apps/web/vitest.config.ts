import { fileURLToPath } from "node:url";
import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));

function resolveViteConfig(env: ConfigEnv): UserConfig {
  return typeof viteConfig === "function" ? viteConfig(env) : viteConfig;
}

export default defineConfig((env) =>
  mergeConfig(
    resolveViteConfig(env),
    defineConfig({
      resolve: {
        alias: {
          "~": srcPath,
        },
      },
      test: {
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        exclude: [
          "src/**/*.browser.{ts,tsx}",
          "src/components/ChatMarkdown.test.tsx",
          "src/components/Sidebar.test.tsx",
          "src/components/chat/ComposerPrimaryActions.test.tsx",
          "src/components/chat/RateLimitMeter.test.tsx",
          "src/components/chat/ThreadSwitcherDropdown.test.tsx",
          "src/components/ui/sheet.test.tsx",
          "src/hooks/useManagedRunCompletionToasts.test.ts",
        ],
      },
    }),
  ),
);
