import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, loadEnv } from "vite";
import pkg from "./package.json" with { type: "json" };

// Load .env files from the monorepo root so a single root-level .env can
// configure dev flags for all packages. Vite only auto-loads these from its
// own project root and never exposes non-VITE_ vars to process.env, so we
// merge them in manually here.
const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const env = { ...rootEnv, ...process.env };

  const port = Number(env.PORT ?? 5733);
  const sourcemapEnv = env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();
  const hmrDisabled = env.T3CODE_DISABLE_HMR === "1";

  const buildSourcemap =
    sourcemapEnv === "0" || sourcemapEnv === "false"
      ? false
      : sourcemapEnv === "hidden"
        ? "hidden"
        : true;

  return {
    plugins: [
      tanstackRouter({
        routeFileIgnorePattern: "(^chatIndex\\.ts$|\\.(?:browser|test)\\.[jt]sx?$)",
      }),
      react(),
      babel({
        // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
        // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
        // whereas the previous version of the plugin parsed all files with a .ts extension.
        // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
        parserOpts: { plugins: ["typescript", "jsx"] },
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
    ],
    optimizeDeps: {
      include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker/worker.js"],
    },
    define: {
      // In dev mode, tell the web app where the WebSocket server lives
      "import.meta.env.VITE_WS_URL": JSON.stringify(env.VITE_WS_URL ?? ""),
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port,
      strictPort: true,
      hmr: hmrDisabled
        ? false
        : {
            // Explicit config so Vite's HMR WebSocket connects reliably
            // inside Electron's BrowserWindow. Vite 8 uses console.debug for
            // connection logs — enable "Verbose" in DevTools to see them.
            protocol: "ws",
            host: "localhost",
          },
      proxy: {
        // Forward backend-owned paths to the T3 server so the dev UI can load
        // attachment bytes and call REST/MCP endpoints without CORS.
        "/attachments": {
          target: `http://localhost:${Number(env.T3CODE_PORT ?? 3773)}`,
          changeOrigin: true,
        },
        "/api": {
          target: `http://localhost:${Number(env.T3CODE_PORT ?? 3773)}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: "./index.html",
          overlay: "./overlay.html",
        },
      },
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: buildSourcemap,
    },
  };
});
