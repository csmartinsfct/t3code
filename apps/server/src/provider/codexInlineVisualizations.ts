import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";

import type { DynamicChatUiArtifactDocument } from "@t3tools/contracts";
import { MAX_DYNAMIC_CHAT_UI_HTML_CHARS } from "@t3tools/shared/dynamicChatUi";
import { parseInlineDirectives } from "@t3tools/shared/inlineDirective";
import { Effect } from "effect";

import { buildDynamicChatUiBlock } from "../dynamicChatUi/artifacts";

const UNAVAILABLE_PREVIEW = "_Preview unavailable: visualization file was removed._";
const DATE_YEAR_SEGMENT = /^\d{4}$/;
const DATE_MONTH_OR_DAY_SEGMENT = /^\d{2}$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_HTML_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/i;
const EXACT_FILE_ATTRIBUTE = /^file="([^"]+)"$/;
const MAX_DYNAMIC_CHAT_UI_HTML_BYTES = MAX_DYNAMIC_CHAT_UI_HTML_CHARS * 4;

export const MAX_VISUALIZATION_DATE_DIRECTORIES = 32;
export const MAX_CODEX_INLINE_VISUALIZATION_DIRECTIVES = 8;

export interface MaterializeCodexInlineVisualizationsInput {
  readonly text: string;
  readonly codexHomePath: string;
  readonly nativeThreadId: string;
  readonly readFile?: (filePath: string) => Promise<string>;
}

export interface MaterializedCodexInlineVisualizations {
  readonly text: string;
  readonly artifacts: DynamicChatUiArtifactDocument[];
}

function isContainedPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function readDirectoryNames(directory: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await fsPromises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .toSorted((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
}

async function findNativeThreadDirectory(input: {
  readonly codexHomePath: string;
  readonly nativeThreadId: string;
}): Promise<string | undefined> {
  if (!SAFE_PATH_SEGMENT.test(input.nativeThreadId)) return undefined;

  const visualizationsPath = path.join(input.codexHomePath, "visualizations");
  let visualizationsRealPath: string;
  try {
    visualizationsRealPath = await fsPromises.realpath(visualizationsPath);
  } catch {
    return undefined;
  }

  let inspectedDateDirectories = 0;
  for (const year of await readDirectoryNames(visualizationsPath, DATE_YEAR_SEGMENT)) {
    const yearPath = path.join(visualizationsPath, year);
    for (const month of await readDirectoryNames(yearPath, DATE_MONTH_OR_DAY_SEGMENT)) {
      const monthPath = path.join(yearPath, month);
      for (const day of await readDirectoryNames(monthPath, DATE_MONTH_OR_DAY_SEGMENT)) {
        if (inspectedDateDirectories >= MAX_VISUALIZATION_DATE_DIRECTORIES) {
          return undefined;
        }
        inspectedDateDirectories += 1;

        const nativeThreadPath = path.join(monthPath, day, input.nativeThreadId);
        let nativeThreadRealPath: string;
        try {
          nativeThreadRealPath = await fsPromises.realpath(nativeThreadPath);
        } catch {
          continue;
        }
        if (!isContainedPath(visualizationsRealPath, nativeThreadRealPath)) continue;
        return nativeThreadRealPath;
      }
    }
  }

  return undefined;
}

function requestedHtmlBasename(attributes: string): string | undefined {
  const match = EXACT_FILE_ATTRIBUTE.exec(attributes);
  const basename = match?.[1];
  if (!basename || !SAFE_HTML_BASENAME.test(basename)) return undefined;
  return basename;
}

function artifactId(nativeThreadId: string, basename: string, directiveStart: number): string {
  const digest = createHash("sha256")
    .update(`${nativeThreadId}:${basename}:${directiveStart}`)
    .digest("hex")
    .slice(0, 16);
  return `codex-inline-vis-${digest}`;
}

async function readVisualizationHtml(input: {
  readonly nativeThreadPath: string;
  readonly basename: string;
  readonly readFile: (filePath: string) => Promise<string>;
}): Promise<string | undefined> {
  try {
    const candidatePath = path.join(input.nativeThreadPath, input.basename);
    const filePath = await fsPromises.realpath(candidatePath);
    if (!isContainedPath(input.nativeThreadPath, filePath)) return undefined;

    const fileStat = await fsPromises.stat(filePath);
    if (!fileStat.isFile() || fileStat.size > MAX_DYNAMIC_CHAT_UI_HTML_BYTES) {
      return undefined;
    }
    return await input.readFile(filePath);
  } catch {
    return undefined;
  }
}

async function materialize(
  input: MaterializeCodexInlineVisualizationsInput,
): Promise<MaterializedCodexInlineVisualizations> {
  const artifacts: DynamicChatUiArtifactDocument[] = [];
  const htmlByBasename = new Map<string, Promise<string | undefined>>();
  const textParts: string[] = [];
  let nativeThreadDirectory: Promise<string | undefined> | undefined;
  let previousEnd = 0;
  let validDirectiveCount = 0;

  const getNativeThreadDirectory = () => {
    nativeThreadDirectory ??= findNativeThreadDirectory({
      codexHomePath: input.codexHomePath,
      nativeThreadId: input.nativeThreadId,
    }).catch(() => undefined);
    return nativeThreadDirectory;
  };

  for (const directive of parseInlineDirectives(input.text)) {
    if (directive.name !== "codex-inline-vis") continue;

    const basename = requestedHtmlBasename(directive.attributes);
    if (!basename) continue;

    textParts.push(input.text.slice(previousEnd, directive.start));
    previousEnd = directive.end;
    validDirectiveCount += 1;

    if (validDirectiveCount > MAX_CODEX_INLINE_VISUALIZATION_DIRECTIVES) {
      textParts.push(UNAVAILABLE_PREVIEW);
      continue;
    }

    try {
      let htmlPromise = htmlByBasename.get(basename);
      if (!htmlPromise) {
        htmlPromise = getNativeThreadDirectory().then((nativeThreadPath) => {
          if (!nativeThreadPath) return undefined;
          return readVisualizationHtml({
            nativeThreadPath,
            basename,
            readFile:
              input.readFile ?? ((filePath) => fsPromises.readFile(filePath, { encoding: "utf8" })),
          });
        });
        htmlByBasename.set(basename, htmlPromise);
      }
      const html = await htmlPromise;
      if (html === undefined) {
        textParts.push(UNAVAILABLE_PREVIEW);
        continue;
      }
      const block = buildDynamicChatUiBlock({
        id: artifactId(input.nativeThreadId, basename, directive.start),
        title: basename.slice(0, -".html".length),
        html,
      });
      if ("error" in block) {
        textParts.push(UNAVAILABLE_PREVIEW);
        continue;
      }

      textParts.push(block.block);
      artifacts.push(block.payload);
    } catch {
      textParts.push(UNAVAILABLE_PREVIEW);
    }
  }

  if (previousEnd === 0) {
    return { text: input.text, artifacts };
  }

  textParts.push(input.text.slice(previousEnd));
  return { text: textParts.join(""), artifacts };
}

export function materializeCodexInlineVisualizations(
  input: MaterializeCodexInlineVisualizationsInput,
): Effect.Effect<MaterializedCodexInlineVisualizations> {
  return Effect.promise(() => materialize(input));
}
