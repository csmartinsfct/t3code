import "../../index.css";

import type {
  NativeApi,
  PreviewPromptDocumentResult,
  PromptDocumentV1,
  PromptDocumentValidationResult,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { waitForElement } from "../../test-utils/browser";
import {
  PROMPTS_PROJECT_ID,
  createPromptDefinitions,
  createPromptDocumentState,
} from "../../test-utils/promptsManagement";
import { PromptEditorDialog } from "./PromptEditorDialog";

const dndState = vi.hoisted(() => ({
  onDragEnd: null as
    | ((event: { active: { id: string }; over: { id: string } | null }) => void)
    | null,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void;
  }) => {
    dndState.onDragEnd = onDragEnd;
    return <div>{children}</div>;
  },
  closestCenter: vi.fn(),
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: <T,>(items: readonly T[], from: number, to: number) => {
    const copy = [...items];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item!);
    return copy;
  },
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: ({ id }: { id: string }) => ({
    attributes: { "data-dnd-id": id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

function queryTextareas(): HTMLTextAreaElement[] {
  return Array.from(document.querySelectorAll("textarea")) as HTMLTextAreaElement[];
}

function asPromptDocument(document: unknown): PromptDocumentV1 {
  return document as PromptDocumentV1;
}

function dispatchTextareaInput(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function createGlobalImplementDocumentState() {
  return createPromptDocumentState({
    promptId: "implement",
    scope: { scope: "global" },
    scopeState: "customized",
    globalBlocks: [
      { when: null, text: "Work on ticket ${ticketId}." },
      { when: { type: "exists", variable: "worktree" }, text: "Worktree: ${worktree}." },
    ],
    effectiveBlocks: [
      { when: null, text: "Work on ticket ${ticketId}." },
      { when: { type: "exists", variable: "worktree" }, text: "Worktree: ${worktree}." },
    ],
  });
}

async function renderEditor({
  documentState = createGlobalImplementDocumentState(),
  scopeInput = { scope: "global" as const },
  onClose = vi.fn(),
  onSaved = vi.fn(),
}: {
  documentState?: ReturnType<typeof createPromptDocumentState>;
  scopeInput?: { scope: "global" } | { scope: "project"; projectId: typeof PROMPTS_PROJECT_ID };
  onClose?: () => void;
  onSaved?: () => void;
}) {
  const screen = await render(
    <PromptEditorDialog
      open
      onClose={onClose}
      onSaved={onSaved}
      documentState={documentState}
      scopeInput={scopeInput}
    />,
  );

  await waitForElement(
    () => queryTextareas()[0] ?? null,
    "Expected the prompt editor to render the initial block list.",
  );

  return { screen, onSaved };
}

describe("PromptEditorDialog browser coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetNativeApiForTests();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("covers block add, remove, and reorder", async () => {
    // Audit traceability: 03a6e3f.
    window.nativeApi = {
      prompts: {
        listDefinitions: vi.fn(),
        getDocument: vi.fn(),
        validateDocument: vi.fn(async () => ({
          scope: { scope: "global" as const },
          promptId: "implement",
          ok: true,
          document: createGlobalImplementDocumentState().effectiveDocument,
          referencedVariables: [],
          errors: [],
        })),
        previewDocument: vi.fn(),
        updateDocument: vi.fn(),
      },
    } as unknown as NativeApi;

    const { screen } = await renderEditor({});

    try {
      await page.getByRole("button", { name: "Add block" }).click();
      await vi.waitFor(() => {
        expect(queryTextareas()).toHaveLength(3);
      });

      const removeButtons = Array.from(document.querySelectorAll("button")).filter(
        (button) => button.getAttribute("aria-label") === "Remove block",
      ) as HTMLButtonElement[];
      removeButtons.at(-1)?.click();
      await vi.waitFor(() => {
        expect(queryTextareas()).toHaveLength(2);
      });

      const dragHandles = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-dnd-id]"));
      expect(dragHandles).toHaveLength(2);
      dndState.onDragEnd?.({
        active: { id: dragHandles[0]!.dataset.dndId! },
        over: { id: dragHandles[1]!.dataset.dndId! },
      });

      await vi.waitFor(() => {
        expect(queryTextareas()[0]?.value).toBe("Worktree: ${worktree}.");
      });
    } finally {
      await screen.unmount();
    }
  });

  it("covers the debounced validation cycle", async () => {
    const validateSpy = vi
      .fn<NativeApi["prompts"]["validateDocument"]>()
      .mockImplementation(async (input) => {
        const nextDocument = asPromptDocument(input.document);
        const hasInvalidBlock = nextDocument.blocks.some((block) => block.text.includes("INVALID"));
        const result: PromptDocumentValidationResult = {
          scope: { scope: "global" },
          promptId: "implement",
          ok: !hasInvalidBlock,
          document: nextDocument,
          referencedVariables: ["ticketId"],
          errors: hasInvalidBlock
            ? [
                {
                  code: "unknown_variable",
                  promptGroupId: "orchestration",
                  promptId: "implement",
                  message: "Unknown variable in block.",
                  path: ["blocks", "0", "text"],
                  blockIndex: 0,
                  variable: "INVALID",
                  token: "${INVALID}",
                },
              ]
            : [],
        };
        return result;
      });

    window.nativeApi = {
      prompts: {
        listDefinitions: vi.fn(),
        getDocument: vi.fn(),
        validateDocument: validateSpy,
        previewDocument: vi.fn(),
        updateDocument: vi.fn(),
      },
    } as unknown as NativeApi;

    const { screen } = await renderEditor({});

    try {
      await vi.advanceTimersByTimeAsync(401);
      validateSpy.mockClear();

      dispatchTextareaInput(queryTextareas()[0]!, "INVALID ${ticketId}");
      await vi.advanceTimersByTimeAsync(401);
      await vi.waitFor(() => {
        expect(validateSpy).toHaveBeenLastCalledWith({
          scope: "global",
          promptId: "implement",
          document: {
            version: 1,
            blocks: [
              { when: null, text: "INVALID ${ticketId}" },
              { when: { type: "exists", variable: "worktree" }, text: "Worktree: ${worktree}." },
            ],
          },
        });
      });
      await expect.element(page.getByText("Unknown variable in block.")).toBeInTheDocument();

      dispatchTextareaInput(queryTextareas()[0]!, "Updated ${ticketId}");
      await vi.advanceTimersByTimeAsync(401);
      await vi.waitFor(() => {
        expect(page.getByText("Unknown variable in block.").query()).toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });

  it("covers preview and save", async () => {
    const definition = createPromptDefinitions({ scope: "global" }).definitions[0]!;
    const documentState = createGlobalImplementDocumentState();
    const previewSpy = vi.fn<NativeApi["prompts"]["previewDocument"]>().mockResolvedValue({
      scope: { scope: "global" },
      promptId: "implement",
      definition,
      document: documentState.effectiveDocument,
      previewText: "Rendered preview text",
      previewDataLabel: "Sample ticket",
      previewVariables: [{ key: "ticketId", value: "T3CO-183" }],
    } satisfies PreviewPromptDocumentResult);
    const updateSpy = vi
      .fn<NativeApi["prompts"]["updateDocument"]>()
      .mockImplementation(async (input) => {
        const nextDocument = input.document === null ? null : asPromptDocument(input.document);
        return createPromptDocumentState({
          promptId: "implement",
          scope: { scope: "global" },
          scopeState: "customized",
          globalBlocks: nextDocument?.blocks ?? [],
          effectiveBlocks: nextDocument?.blocks ?? [],
        });
      });
    const onSaved = vi.fn();

    window.nativeApi = {
      prompts: {
        listDefinitions: vi.fn(),
        getDocument: vi.fn(),
        validateDocument: vi.fn(async (input) => ({
          scope: { scope: "global" as const },
          promptId: "implement",
          ok: true,
          document: asPromptDocument(input.document),
          referencedVariables: ["ticketId"],
          errors: [],
        })),
        previewDocument: previewSpy,
        updateDocument: updateSpy,
      },
    } as unknown as NativeApi;

    const { screen } = await renderEditor({ documentState, onSaved });

    try {
      dispatchTextareaInput(queryTextareas()[0]!, "Updated ${ticketId}");
      await vi.advanceTimersByTimeAsync(401);

      const previewButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Preview",
          ) as HTMLButtonElement | null,
        "Expected the prompt editor preview toggle to be rendered.",
      );
      previewButton.click();
      await vi.waitFor(() => {
        expect(previewSpy).toHaveBeenCalledWith({
          scope: "global",
          promptId: "implement",
          document: {
            version: 1,
            blocks: [
              { when: null, text: "Updated ${ticketId}" },
              { when: { type: "exists", variable: "worktree" }, text: "Worktree: ${worktree}." },
            ],
          },
        });
      });
      await expect.element(page.getByText("Rendered preview text")).toBeInTheDocument();

      const saveButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Save",
          ) as HTMLButtonElement | null,
        "Expected the prompt editor save button to be rendered.",
      );
      expect(saveButton.disabled).toBe(false);
      saveButton.click();

      await vi.waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith({
          scope: "global",
          promptId: "implement",
          document: {
            version: 1,
            blocks: [
              { when: null, text: "Updated ${ticketId}" },
              { when: { type: "exists", variable: "worktree" }, text: "Worktree: ${worktree}." },
            ],
          },
        });
      });
      expect(onSaved).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("covers reverting a project override", async () => {
    const updateSpy = vi.fn<NativeApi["prompts"]["updateDocument"]>().mockImplementation(async () =>
      createPromptDocumentState({
        promptId: "review",
        scope: { scope: "project", projectId: PROMPTS_PROJECT_ID },
        scopeState: "inherited",
        effectiveSource: "global",
        globalBlocks: [{ when: null, text: "Global review prompt." }],
        effectiveBlocks: [{ when: null, text: "Global review prompt." }],
      }),
    );
    const onSaved = vi.fn();

    window.nativeApi = {
      prompts: {
        listDefinitions: vi.fn(),
        getDocument: vi.fn(),
        validateDocument: vi.fn(async () => ({
          scope: { scope: "project" as const, projectId: PROMPTS_PROJECT_ID },
          promptId: "review",
          ok: true,
          document: {
            version: 1 as const,
            blocks: [{ when: null, text: "Project review override." }],
          },
          referencedVariables: [],
          errors: [],
        })),
        previewDocument: vi.fn(),
        updateDocument: updateSpy,
      },
    } as unknown as NativeApi;

    const screen = await render(
      <PromptEditorDialog
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        documentState={createPromptDocumentState({
          promptId: "review",
          scope: { scope: "project", projectId: PROMPTS_PROJECT_ID },
          scopeState: "overridden",
          effectiveSource: "project_override",
          globalBlocks: [{ when: null, text: "Global review prompt." }],
          projectBlocks: [{ when: null, text: "Project review override." }],
          effectiveBlocks: [{ when: null, text: "Project review override." }],
        })}
        scopeInput={{ scope: "project", projectId: PROMPTS_PROJECT_ID }}
      />,
    );

    try {
      const revertButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Revert to global",
          ) as HTMLButtonElement | null,
        "Expected the revert button to be rendered for a project override.",
      );
      revertButton.click();
      await vi.waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith({
          scope: "project",
          projectId: PROMPTS_PROJECT_ID,
          promptId: "review",
          document: null,
        });
      });
      expect(onSaved).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});
