import "../../index.css";

import type { NativeApi, PromptDocumentState, ProjectId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { useStore } from "../../store";
import {
  PROMPTS_PROJECT_ID,
  createPromptDefinitions,
  createPromptDocumentState,
  createPromptsProject,
} from "../../test-utils/promptsManagement";
import { Sidebar, SidebarProvider } from "../ui/sidebar";
import { PromptsPanel } from "./PromptsPanel";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function createStateMap(scope: "global" | "project"): Record<string, PromptDocumentState> {
  const scopeInput =
    scope === "project"
      ? { scope: "project" as const, projectId: PROMPTS_PROJECT_ID }
      : { scope: "global" as const };

  return {
    implement: createPromptDocumentState({
      promptId: "implement",
      scope: scopeInput,
      scopeState: scope === "project" ? "inherited" : "default",
      effectiveSource: scope === "project" ? "global" : "shipped_default",
    }),
    review: createPromptDocumentState({
      promptId: "review",
      scope: scopeInput,
      scopeState: scope === "project" ? "overridden" : "customized",
      effectiveSource: scope === "project" ? "project_override" : "global",
      globalBlocks: [{ when: null, text: "Global review prompt." }],
      projectBlocks:
        scope === "project" ? [{ when: null, text: "Project review override." }] : null,
    }),
  };
}

describe("PromptsPanel browser coverage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
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

  it("navigates from Settings to the Prompts section", async () => {
    const screen = await render(
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SettingsSidebarNav pathname="/settings/general" />
        </Sidebar>
      </SidebarProvider>,
    );

    try {
      await page.getByRole("button", { name: "Prompts" }).click();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/prompts",
        replace: true,
      });
    } finally {
      await screen.unmount();
    }
  });

  it("covers scope switching, badge rendering, and editor open and close", async () => {
    // Audit traceability: 03a6e3f.
    const globalDefinitions = createPromptDefinitions({ scope: "global" });
    const globalStates = createStateMap("global");
    const projectDefinitions = createPromptDefinitions({
      scope: "project",
      projectId: PROMPTS_PROJECT_ID,
    });
    const projectStates = createStateMap("project");

    const listDefinitionsSpy = vi
      .fn<NativeApi["prompts"]["listDefinitions"]>()
      .mockImplementation(async (scope) =>
        scope.scope === "project" ? projectDefinitions : globalDefinitions,
      );
    const getDocumentSpy = vi
      .fn<NativeApi["prompts"]["getDocument"]>()
      .mockImplementation(async (input) => {
        const stateSet = input.scope === "project" ? projectStates : globalStates;
        return stateSet[input.promptId]!;
      });

    window.nativeApi = {
      prompts: {
        listDefinitions: listDefinitionsSpy,
        getDocument: getDocumentSpy,
        validateDocument: vi.fn(async () => ({
          scope: { scope: "global" as const },
          promptId: "implement",
          ok: true,
          document: { version: 1 as const, blocks: [{ when: null, text: "ok" }] },
          referencedVariables: [],
          errors: [],
        })),
        previewDocument: vi.fn(async () => ({
          scope: { scope: "global" as const },
          promptId: "implement",
          definition: globalDefinitions.definitions[0]!,
          document: { version: 1 as const, blocks: [{ when: null, text: "Preview block" }] },
          previewText: "Preview block",
          previewDataLabel: "Sample ticket",
          previewVariables: [],
        })),
        updateDocument: vi.fn(async () => globalStates.implement),
      },
    } as unknown as NativeApi;

    const screen = await render(<PromptsPanel />);

    try {
      await expect.element(page.getByRole("heading", { name: "Implement" })).toBeInTheDocument();
      await expect.element(page.getByText("Default")).toBeInTheDocument();
      await expect.element(page.getByText("Customized")).toBeInTheDocument();

      await page.getByLabelText("Prompt scope").click();
      await page.getByRole("option", { name: "Project Alpha", exact: true }).click();

      await vi.waitFor(() => {
        expect(listDefinitionsSpy).toHaveBeenCalledWith({
          scope: "project",
          projectId: PROMPTS_PROJECT_ID,
        });
      });
      await expect.element(page.getByText("Inherited")).toBeInTheDocument();
      await expect.element(page.getByText("Overridden")).toBeInTheDocument();

      const editButtons = Array.from(document.querySelectorAll("button")).filter((button) =>
        button.textContent?.includes("Edit"),
      ) as HTMLButtonElement[];
      expect(editButtons.length).toBeGreaterThan(0);
      editButtons[0]!.click();

      await expect.element(page.getByText("Edit Prompt")).not.toBeInTheDocument();
      await expect.element(page.getByRole("heading", { name: "Implement" })).toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

      await page.getByRole("button", { name: "Cancel" }).click();
      await vi.waitFor(() => {
        expect(document.body.textContent?.includes("Available variables")).toBe(false);
      });

      expect(getDocumentSpy).toHaveBeenCalledWith({
        scope: "project",
        projectId: PROMPTS_PROJECT_ID as ProjectId,
        promptId: "review",
      });
    } finally {
      await screen.unmount();
    }
  });
});
