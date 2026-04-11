import "../index.css";

import type {
  ManagedRunRuntimeService,
  ManagedRunSummary,
  NativeApi,
  ProjectId,
  ProjectScript,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../nativeApi";
import ManagedRunsControl from "./ManagedRunsControl";

const PROJECT_ID = "project-1" as ProjectId;
const NOW_ISO = "2026-04-11T12:00:00.000Z";

function createRuntimeService(input?: Partial<ManagedRunRuntimeService>): ManagedRunRuntimeService {
  return {
    declaredServiceName: "frontend",
    resolvedName: "Frontend",
    role: "frontend",
    canonicalHealthCheck: {
      type: "url",
      url: "http://localhost:3773",
    },
    validationStatus: "healthy",
    inferenceConfidence: "high",
    inferenceSource: "llm",
    groundedBy: ["declared"],
    evidenceLines: [],
    lastCheckedAt: NOW_ISO,
    ...input,
  };
}

function createRun(input?: Partial<ManagedRunSummary>): ManagedRunSummary {
  return {
    runId: "run-1" as ManagedRunSummary["runId"],
    projectId: PROJECT_ID,
    scriptId: "dev-server",
    createdByThreadId: null,
    lastTouchedByThreadId: null,
    cwd: "/repo/project",
    launchMode: "attached",
    status: "running",
    detectedUrl: null,
    detectedPort: null,
    terminalThreadId: null,
    terminalId: null,
    terminalPid: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    startedAt: NOW_ISO,
    completedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    declaredServices: [],
    runtimeServices: [createRuntimeService()],
    inferenceStatus: "ready",
    inferenceUpdatedAt: NOW_ISO,
    inferenceError: null,
    ...input,
  };
}

describe("ManagedRunsControl browser coverage", () => {
  const clipboardWriteText = vi.fn<(value: string) => Promise<void>>();
  const openSpy =
    vi.fn<(url?: string | URL, target?: string, features?: string) => Window | null>();
  const confirmSpy = vi.fn<NativeApi["dialogs"]["confirm"]>();
  const stopSpy = vi.fn<NativeApi["managedRuns"]["stop"]>();
  let originalClipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    __resetNativeApiForTests();
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue();
    openSpy.mockReset();
    openSpy.mockReturnValue(null);
    confirmSpy.mockReset();
    confirmSpy.mockResolvedValue(true);
    stopSpy.mockReset();
    stopSpy.mockResolvedValue(undefined);

    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
    vi.stubGlobal("open", openSpy);
    window.nativeApi = {
      dialogs: {
        confirm: confirmSpy,
      },
      managedRuns: {
        stop: stopSpy,
      },
    } as unknown as NativeApi;
  });

  afterEach(() => {
    __resetNativeApiForTests();
    vi.unstubAllGlobals();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      delete (navigator as { clipboard?: Clipboard }).clipboard;
    }
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("covers the run hover card plus confirmed stop-run behavior", async () => {
    // Audit traceability: e647687.
    const scripts: readonly ProjectScript[] = [
      {
        id: "dev-server",
        name: "Dev Server",
        command: "bun run dev",
        icon: "play",
        runOnWorktreeCreate: false,
        services: [],
      },
    ];

    const screen = await render(<ManagedRunsControl runs={[createRun()]} scripts={scripts} />);

    try {
      await page.getByRole("button", { name: /Runs/ }).click();
      await expect.element(page.getByText("Dev Server")).toBeInTheDocument();
      await expect.element(page.getByText("Frontend")).toBeInTheDocument();

      await page.getByText("Frontend").hover();

      await expect.element(page.getByText("http://localhost:3773")).toBeInTheDocument();
      await expect.element(page.getByText("healthy")).toBeInTheDocument();

      await expect.element(page.getByTitle("Copy URL")).toBeInTheDocument();
      document.querySelector<HTMLButtonElement>('button[title="Copy URL"]')?.click();
      await vi.waitFor(() => {
        expect(clipboardWriteText).toHaveBeenCalledWith("http://localhost:3773");
      });

      await expect.element(page.getByTitle("Open in browser")).toBeInTheDocument();
      document.querySelector<HTMLButtonElement>('button[title="Open in browser"]')?.click();
      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:3773",
        "_blank",
        "noopener,noreferrer",
      );

      await page.getByText("Dev Server").hover();
      await page.getByRole("button", { name: "Stop" }).click();

      await vi.waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledWith(
          [
            'Stop run "Dev Server"?',
            "",
            "This will stop the active managed run and any tracked services it owns.",
          ].join("\n"),
        );
      });
      expect(stopSpy).toHaveBeenCalledWith({ runId: "run-1" });
    } finally {
      await screen.unmount();
    }
  });
});
