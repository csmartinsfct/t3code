import "../index.css";

import type { NativeApi } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../nativeApi";
import { useStore } from "../store";
import {
  createPromptDocumentState,
  createPromptDefinitions,
  createPromptsProject,
} from "../test-utils/promptsManagement";
import { Route } from "./settings.prompts";

describe("settings.prompts route browser coverage", () => {
  beforeEach(() => {
    __resetNativeApiForTests();
    useStore.setState({
      projects: [createPromptsProject()],
    });
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("registers /settings/prompts and renders the prompts route component", async () => {
    // Audit traceability: 03a6e3f.
    const definitions = createPromptDefinitions({ scope: "global" });
    const states: Record<"implement" | "review", ReturnType<typeof createPromptDocumentState>> = {
      implement: createPromptDocumentState({
        promptId: "implement",
        scope: { scope: "global" },
        scopeState: "default",
        effectiveSource: "shipped_default",
      }),
      review: createPromptDocumentState({
        promptId: "review",
        scope: { scope: "global" },
        scopeState: "customized",
        effectiveSource: "global",
        globalBlocks: [{ when: null, text: "Customized global review prompt." }],
      }),
    };

    window.nativeApi = {
      prompts: {
        listDefinitions: vi.fn(async () => definitions),
        getDocument: vi.fn(async (input) => states[input.promptId as "implement" | "review"]),
        validateDocument: vi.fn(),
        previewDocument: vi.fn(),
        updateDocument: vi.fn(),
      },
    } as unknown as NativeApi;

    const RouteComponent = Route.options.component;
    if (!RouteComponent) {
      throw new Error("Expected /settings/prompts route component to be registered.");
    }

    const screen = await render(<RouteComponent />);

    try {
      await expect.element(page.getByText("Orchestration")).toBeInTheDocument();
      await expect.element(page.getByRole("heading", { name: "Implement" })).toBeInTheDocument();
      await expect.element(page.getByText("Customized")).toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });
});
