import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  emptyEmbeddedBrowserTabState,
  parseEmbeddedBrowserTabState,
  readEmbeddedBrowserTabState,
  upsertEmbeddedBrowserProjectTabState,
  writeEmbeddedBrowserTabState,
} from "./embeddedBrowserTabState";

describe("embedded browser tab state", () => {
  it("parses valid projects and falls back to the first tab for stale active ids", () => {
    expect(
      parseEmbeddedBrowserTabState({
        version: 1,
        projects: {
          "project-1": {
            activeTabId: 99,
            tabs: [
              { id: 2, url: "https://example.com/", title: "Example", favicon: null },
              {
                id: 4,
                url: "chrome-extension://abcdef/popup.html",
                title: "Popup",
                favicon: "https://example.com/favicon.ico",
              },
            ],
          },
        },
      }),
    ).toEqual({
      version: 1,
      projects: {
        "project-1": {
          activeTabId: 2,
          tabs: [
            { id: 2, url: "https://example.com/", title: "Example", favicon: null },
            {
              id: 4,
              url: "chrome-extension://abcdef/popup.html",
              title: "Popup",
              favicon: "https://example.com/favicon.ico",
            },
          ],
        },
      },
    });
  });

  it("drops unsafe projects, duplicate tabs, and unsupported URLs", () => {
    expect(
      parseEmbeddedBrowserTabState({
        version: 1,
        projects: {
          "..": {
            activeTabId: 0,
            tabs: [{ id: 0, url: "https://example.com/" }],
          },
          good: {
            activeTabId: 1,
            tabs: [
              { id: 1, url: "https://example.com/" },
              { id: 1, url: "https://duplicate.example/" },
              { id: 2, url: "file:///etc/passwd" },
              { id: 3, url: "javascript:alert(1)" },
              { id: 4, url: "about:blank" },
            ],
          },
        },
      }),
    ).toEqual({
      version: 1,
      projects: {
        good: {
          activeTabId: 1,
          tabs: [
            { id: 1, url: "https://example.com/", title: "", favicon: null },
            { id: 4, url: "about:blank", title: "", favicon: null },
          ],
        },
      },
    });
  });

  it("returns an empty state for corrupt or unsupported files", () => {
    expect(parseEmbeddedBrowserTabState(null)).toBe(emptyEmbeddedBrowserTabState());
    expect(parseEmbeddedBrowserTabState({ version: 2, projects: {} })).toBe(
      emptyEmbeddedBrowserTabState(),
    );
  });

  it("upserts projects without clobbering other project state", () => {
    const first = upsertEmbeddedBrowserProjectTabState(
      emptyEmbeddedBrowserTabState(),
      "project-a",
      {
        activeTabId: 0,
        tabs: [{ id: 0, url: "https://a.example/", title: "", favicon: null }],
      },
    );
    const second = upsertEmbeddedBrowserProjectTabState(first, "project-b", {
      activeTabId: 7,
      tabs: [{ id: 7, url: "https://b.example/", title: "B", favicon: null }],
    });

    expect(second.projects["project-a"]?.tabs[0]?.url).toBe("https://a.example/");
    expect(second.projects["project-b"]?.activeTabId).toBe(7);
  });

  it("writes atomically and reads the persisted state", () => {
    const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "t3-browser-tabs-"));
    const filePath = Path.join(dir, "browser", "tab-state.json");

    const state = upsertEmbeddedBrowserProjectTabState(
      emptyEmbeddedBrowserTabState(),
      "project-a",
      {
        activeTabId: 0,
        tabs: [{ id: 0, url: "about:blank", title: "", favicon: null }],
      },
    );
    writeEmbeddedBrowserTabState(filePath, state);

    expect(readEmbeddedBrowserTabState(filePath)).toEqual(state);
  });
});
