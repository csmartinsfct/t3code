import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));

export default mergeConfig(
  viteConfig,
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
);
