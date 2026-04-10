import "../../index.css";

import type { NativeApi, TicketSummary } from "@t3tools/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "~/nativeApi";
import { useStore } from "~/store";
import { useTicketSelectionStore } from "~/ticketSelectionStore";
import { useUiStateStore } from "~/uiStateStore";
import { SidebarProvider } from "../ui/sidebar";
import { ManagementView } from "./ManagementView";

// Audit traceability: 4973c83.

function makeTicket(projectId: string): TicketSummary {
  const isSecondProject = projectId === "project-2";
  return {
    id: (isSecondProject ? "ticket-2" : "ticket-1") as TicketSummary["id"],
    projectId: projectId as TicketSummary["projectId"],
    parentId: null,
    ticketNumber: isSecondProject ? 2 : 1,
    identifier: isSecondProject ? "T3CO-2" : "T3CO-1",
    title: isSecondProject ? "Beta ticket" : "Alpha ticket",
    status: "todo",
    priority: "medium",
    sortOrder: 0,
    isArchived: false,
    worktree: null,
    labels: [],
    subTicketCount: 0,
    dependencyCount: 0,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
  };
}

function installNativeApiStub() {
  const api: Partial<NativeApi> = {
    orchestration: {
      getSnapshot: vi.fn(async () => ({
        projects: [
          { id: "project-1", title: "Project One", workspaceRoot: "/repo/project-1" },
          { id: "project-2", title: "Project Two", workspaceRoot: "/repo/project-2" },
        ],
      })),
    } as unknown as NativeApi["orchestration"],
    ticketing: {
      list: vi.fn(async ({ projectId }: { projectId: string }) => [makeTicket(projectId)]),
      onEvent: vi.fn(() => () => {}),
    } as unknown as NativeApi["ticketing"],
  };

  window.nativeApi = api as NativeApi;
}

function seedStores() {
  useStore.setState({
    projects: [
      {
        id: "project-1",
        name: "Project One",
        cwd: "/repo/project-1",
        defaultModelSelection: null,
        systemPrompt: null,
        promptOverrides: {},
        scripts: [],
      },
      {
        id: "project-2",
        name: "Project Two",
        cwd: "/repo/project-2",
        defaultModelSelection: null,
        systemPrompt: null,
        promptOverrides: {},
        scripts: [],
      },
    ] as any,
    threads: [],
    threadsById: {},
    sidebarThreadsById: {},
    threadIdsByProjectId: {},
    bootstrapComplete: true,
    orchestrationRunStatusByThreadId: {},
  });

  useUiStateStore.setState((state) => ({
    ...state,
    boardContextByThreadId: {},
    managementLastProjectId: null,
  }));

  useTicketSelectionStore.setState({
    selectedTicketIds: new Set(),
    selectedTickets: new Map(),
    anchorTicketId: null,
  });
}

function Harness() {
  const [mode, setMode] = useState<"chat" | "management">("chat");
  const [projectId, setProjectId] = useState("project-1");

  return (
    <SidebarProvider defaultOpen>
      <button type="button" onClick={() => setMode("chat")}>
        Chat mode
      </button>
      <button type="button" onClick={() => setMode("management")}>
        Board mode
      </button>
      <button type="button" onClick={() => setProjectId("project-2")}>
        Project 2
      </button>
      {mode === "management" ? (
        <ManagementView threadId={null} projectId={projectId} />
      ) : (
        <div data-testid="chat-mode-shell">Chat shell</div>
      )}
    </SidebarProvider>
  );
}

describe("ManagementView", () => {
  beforeEach(() => {
    __resetNativeApiForTests();
    installNativeApiStub();
    seedStores();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("switches from chat mode into the mounted management board and renders the empty chat placeholder", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      await expect.element(page.getByTestId("chat-mode-shell")).toBeInTheDocument();

      await page.getByRole("button", { name: "Board mode" }).click();

      await expect.element(page.getByRole("heading", { name: "Board" })).toBeInTheDocument();
      await expect.element(page.getByText("Project One")).toBeInTheDocument();
      await expect.element(page.getByText("Alpha ticket")).toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("clears the mounted board selection when the active project changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<Harness />, { container: host });

    try {
      useTicketSelectionStore.setState({
        selectedTicketIds: new Set(["ticket-1" as TicketSummary["id"]]),
        selectedTickets: new Map([["ticket-1" as TicketSummary["id"], makeTicket("project-1")]]),
        anchorTicketId: "ticket-1" as TicketSummary["id"],
      });

      await page.getByRole("button", { name: "Board mode" }).click();
      await expect.element(page.getByText("Alpha ticket")).toBeInTheDocument();

      await page.getByRole("button", { name: "Project 2" }).click();

      await expect.element(page.getByText("Project Two")).toBeInTheDocument();
      await expect.element(page.getByText("Beta ticket")).toBeInTheDocument();
      await vi.waitFor(() => {
        expect(useTicketSelectionStore.getState().selectedTicketIds.size).toBe(0);
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
