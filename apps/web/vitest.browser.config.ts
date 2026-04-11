import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
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
      include: [
        "src/components/**/*.browser.tsx",
        "src/components/ChatMarkdown.test.tsx",
        "src/components/Sidebar.test.tsx",
        "src/components/chat/ThreadSwitcherDropdown.test.tsx",
        "src/hooks/useManagedRunCompletionToasts.test.ts",
        "src/routes/**/*.browser.tsx",
        "src/components/ui/sheet.test.tsx",
      ],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
        headless: true,
      },
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
