import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MAX_DYNAMIC_CHAT_UI_HTML_CHARS } from "@t3tools/shared/dynamicChatUi";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  materializeCodexInlineVisualizations,
  MAX_CODEX_INLINE_VISUALIZATION_DIRECTIVES,
  MAX_VISUALIZATION_DATE_DIRECTORIES,
} from "./codexInlineVisualizations";

const nativeThreadId = "01980a2e-8ca3-7000-8000-7e6dd4afae22";
const unavailablePreview = "_Preview unavailable: visualization file was removed._";

describe("materializeCodexInlineVisualizations", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of tempDirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function makeCodexHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "t3-codex-visualizations-"));
    tempDirs.push(home);
    return home;
  }

  function writeVisualization(input: {
    readonly codexHomePath: string;
    readonly filename: string;
    readonly html: string;
  }): string {
    const directory = path.join(
      input.codexHomePath,
      "visualizations",
      "2026",
      "07",
      "11",
      nativeThreadId,
    );
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, input.filename);
    fs.writeFileSync(filePath, input.html, "utf8");
    return filePath;
  }

  function materialize(input: {
    readonly text: string;
    readonly codexHomePath: string;
    readonly readFile?: (filePath: string) => Promise<string>;
  }) {
    return Effect.runPromise(
      materializeCodexInlineVisualizations({
        text: input.text,
        codexHomePath: input.codexHomePath,
        nativeThreadId,
        ...(input.readFile ? { readFile: input.readFile } : {}),
      }),
    );
  }

  it("imports a visualization from a configured Codex home", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "chart.html",
      html: "<main>Chart</main>",
    });

    const result = await materialize({
      codexHomePath,
      text: 'Before ::codex-inline-vis{file="chart.html"} after',
    });

    expect(result.text).toContain("Before ```t3:dynamic-chat-ui");
    expect(result.text).toContain(" after");
    expect(result.text).not.toContain("::codex-inline-vis");
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        id: "codex-inline-vis-701b4d7347bf8512",
        title: "chart",
        html: "<main>Chart</main>",
      }),
    ]);
  });

  it("replaces valid references to missing files with an unavailable preview", async () => {
    const result = await materialize({
      codexHomePath: makeCodexHome(),
      text: '::codex-inline-vis{file="missing.html"}',
    });

    expect(result).toEqual({ text: unavailablePreview, artifacts: [] });
  });

  it("leaves unsafe or non-exact file attributes literal", async () => {
    const codexHomePath = makeCodexHome();
    const text = [
      '::codex-inline-vis{file="../chart.html"}',
      '::codex-inline-vis{file="chart.html" title="Chart"}',
      '::codex-inline-vis{file="chart.htm"}',
    ].join("\n");

    await expect(materialize({ codexHomePath, text })).resolves.toEqual({
      text,
      artifacts: [],
    });
  });

  it("leaves unrelated directives literal", async () => {
    const codexHomePath = makeCodexHome();
    const text = '::other-inline-vis{file="chart.html"}';

    await expect(materialize({ codexHomePath, text })).resolves.toEqual({
      text,
      artifacts: [],
    });
  });

  it("replaces oversized valid files with an unavailable preview", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "oversized.html",
      html: "x".repeat(MAX_DYNAMIC_CHAT_UI_HTML_CHARS + 1),
    });

    await expect(
      materialize({
        codexHomePath,
        text: '::codex-inline-vis{file="oversized.html"}',
      }),
    ).resolves.toEqual({ text: unavailablePreview, artifacts: [] });
  });

  it("does not follow a visualization file symlink outside the native thread directory", async () => {
    const codexHomePath = makeCodexHome();
    const externalFile = path.join(codexHomePath, "outside.html");
    fs.writeFileSync(externalFile, "<main>outside</main>", "utf8");
    const linkedFile = writeVisualization({
      codexHomePath,
      filename: "linked.html",
      html: "placeholder",
    });
    fs.rmSync(linkedFile);
    fs.symlinkSync(externalFile, linkedFile);

    await expect(
      materialize({
        codexHomePath,
        text: '::codex-inline-vis{file="linked.html"}',
      }),
    ).resolves.toEqual({ text: unavailablePreview, artifacts: [] });
  });

  it("uses asynchronous filesystem discovery", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "async.html",
      html: "<main>Async</main>",
    });
    const readdirSync = vi.spyOn(fs, "readdirSync");
    const realpathSync = vi.spyOn(fs, "realpathSync");

    const result = await materialize({
      codexHomePath,
      text: '::codex-inline-vis{file="async.html"}',
    });

    expect(result.artifacts).toHaveLength(1);
    expect(readdirSync).not.toHaveBeenCalled();
    expect(realpathSync).not.toHaveBeenCalled();
  });

  it("stops discovery before date directories beyond the inspection cap", async () => {
    const codexHomePath = makeCodexHome();
    const monthPath = path.join(codexHomePath, "visualizations", "2026", "07");
    for (let day = 0; day <= MAX_VISUALIZATION_DATE_DIRECTORIES; day += 1) {
      fs.mkdirSync(path.join(monthPath, String(day).padStart(2, "0")), { recursive: true });
    }
    const beyondCapDirectory = path.join(monthPath, "00", nativeThreadId);
    fs.mkdirSync(beyondCapDirectory);
    fs.writeFileSync(path.join(beyondCapDirectory, "old.html"), "<main>Too old</main>", "utf8");

    await expect(
      materialize({
        codexHomePath,
        text: '::codex-inline-vis{file="old.html"}',
      }),
    ).resolves.toEqual({ text: unavailablePreview, artifacts: [] });
  });

  it("rejects files beyond the UTF-8 byte cap before reading them", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "too-many-bytes.html",
      html: "x".repeat(MAX_DYNAMIC_CHAT_UI_HTML_CHARS * 4 + 1),
    });
    let readCount = 0;

    await expect(
      materialize({
        codexHomePath,
        text: '::codex-inline-vis{file="too-many-bytes.html"}',
        readFile: async (filePath) => {
          readCount += 1;
          return fs.promises.readFile(filePath, "utf8");
        },
      }),
    ).resolves.toEqual({ text: unavailablePreview, artifacts: [] });
    expect(readCount).toBe(0);
  });

  it("gives repeated directives distinct deterministic ids while reading the file once", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "chart.html",
      html: "<main>Repeated</main>",
    });
    let readCount = 0;
    const directive = '::codex-inline-vis{file="chart.html"}';

    const result = await materialize({
      codexHomePath,
      text: `${directive}\n${directive}`,
      readFile: async (filePath) => {
        readCount += 1;
        return fs.promises.readFile(filePath, "utf8");
      },
    });

    expect(result.artifacts).toHaveLength(2);
    expect(new Set(result.artifacts.map((artifact) => artifact.id)).size).toBe(2);
    expect(result.text.match(/```t3:dynamic-chat-ui/g)).toHaveLength(2);
    expect(readCount).toBe(1);
  });

  it("resolves the native thread directory once for multiple basenames", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "first.html",
      html: "<main>First</main>",
    });
    writeVisualization({
      codexHomePath,
      filename: "second.html",
      html: "<main>Second</main>",
    });
    const realpath = vi.spyOn(fs.promises, "realpath");

    const result = await materialize({
      codexHomePath,
      text: [
        '::codex-inline-vis{file="first.html"}',
        '::codex-inline-vis{file="second.html"}',
      ].join("\n"),
    });

    expect(result.artifacts).toHaveLength(2);
    expect(
      realpath.mock.calls.filter(([filePath]) => String(filePath).endsWith(nativeThreadId)),
    ).toHaveLength(1);
  });

  it("caps valid visualization directives per message", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "chart.html",
      html: "<main>Chart</main>",
    });
    const directive = '::codex-inline-vis{file="chart.html"}';

    const result = await materialize({
      codexHomePath,
      text: Array.from(
        { length: MAX_CODEX_INLINE_VISUALIZATION_DIRECTIVES + 2 },
        () => directive,
      ).join("\n"),
    });

    expect(result.artifacts).toHaveLength(MAX_CODEX_INLINE_VISUALIZATION_DIRECTIVES);
    expect(result.text.match(/```t3:dynamic-chat-ui/g)).toHaveLength(
      MAX_CODEX_INLINE_VISUALIZATION_DIRECTIVES,
    );
    expect(result.text.split(unavailablePreview)).toHaveLength(3);
  });

  it("caches rejected reads for repeated basenames", async () => {
    const codexHomePath = makeCodexHome();
    writeVisualization({
      codexHomePath,
      filename: "broken.html",
      html: "<main>Broken</main>",
    });
    let readCount = 0;
    const directive = '::codex-inline-vis{file="broken.html"}';

    const result = await materialize({
      codexHomePath,
      text: `${directive}\n${directive}`,
      readFile: async () => {
        readCount += 1;
        throw new Error("read failed");
      },
    });

    expect(result.text).toBe(`${unavailablePreview}\n${unavailablePreview}`);
    expect(result.artifacts).toEqual([]);
    expect(readCount).toBe(1);
  });
});
