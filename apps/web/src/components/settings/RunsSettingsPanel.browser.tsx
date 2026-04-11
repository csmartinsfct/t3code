import "../../index.css";

import type {
  ManagedRunInferenceRecordDetail,
  ManagedRunInferenceRecordSummary,
  NativeApi,
  ProjectId,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { waitForElement } from "../../test-utils/browser";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { RunsSettingsPanel } from "./RunsSettingsPanel";
import { Sidebar, SidebarProvider } from "../ui/sidebar";

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

const NOW_ISO = "2026-04-11T12:00:00.000Z";

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createRecord(
  input: Partial<ManagedRunInferenceRecordSummary> & {
    inferenceId: string;
    projectId: ProjectId;
    scriptId: string;
  },
): ManagedRunInferenceRecordSummary {
  return {
    inferenceId: input.inferenceId,
    runId: `run-${input.inferenceId}` as ManagedRunInferenceRecordSummary["runId"],
    projectId: input.projectId,
    scriptId: input.scriptId,
    scriptName: input.scriptName ?? input.scriptId,
    cwd: input.cwd ?? `/repo/${input.projectId}`,
    provider: input.provider ?? "codex",
    model: input.model ?? "gpt-5.4-mini",
    status: input.status ?? "ready",
    createdAt: input.createdAt ?? NOW_ISO,
    runtimeServiceCount: input.runtimeServiceCount ?? 1,
  };
}

function createDetail(
  input: Partial<ManagedRunInferenceRecordDetail> & {
    inferenceId: string;
    runId: ManagedRunInferenceRecordSummary["runId"];
    projectId: ProjectId;
    scriptId: string;
  },
): ManagedRunInferenceRecordDetail {
  return {
    inferenceId: input.inferenceId,
    runId: input.runId,
    projectId: input.projectId,
    scriptId: input.scriptId,
    scriptName: input.scriptName ?? input.scriptId,
    cwd: input.cwd ?? `/repo/${input.projectId}`,
    provider: input.provider ?? "codex",
    model: input.model ?? "gpt-5.4-mini",
    status: input.status ?? "ready",
    createdAt: input.createdAt ?? NOW_ISO,
    runtimeServiceCount: input.runtimeServiceCount ?? 1,
    declaredServices: input.declaredServices ?? [
      {
        name: "frontend",
        healthCheck: {
          type: "url",
          url: "http://localhost:3773",
        },
      },
    ],
    normalizedPayload: input.normalizedPayload ?? {
      runtimeServices: [{ name: "frontend", role: "frontend" }],
    },
    rawPayload: input.rawPayload ?? {
      providerResponse: {
        services: ["frontend"],
      },
    },
    inferenceError: input.inferenceError ?? null,
    groundingFailures: input.groundingFailures ?? [],
    evidenceExcerpt: input.evidenceExcerpt ?? ["Found http://localhost:3773 in logs."],
  };
}

async function selectFilterOption(index: number, optionLabel: string): Promise<void> {
  const trigger = await waitForElement(
    () => document.querySelectorAll<HTMLElement>('[data-slot="select-trigger"]')[index] ?? null,
    `Unable to find select trigger at index ${index}.`,
  );
  trigger.click();
  await waitForElement(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (element) => element.textContent?.trim() === optionLabel,
      ) ?? null,
    `Unable to find select option "${optionLabel}".`,
  );
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

describe("RunsSettingsPanel browser coverage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    __resetNativeApiForTests();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("navigates from Settings to the Runs section", async () => {
    const screen = await render(
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SettingsSidebarNav pathname="/settings/general" />
        </Sidebar>
      </SidebarProvider>,
    );

    try {
      await page.getByRole("button", { name: "Runs" }).click();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/runs",
        replace: true,
      });
    } finally {
      await screen.unmount();
    }
  });

  it("covers filters, lazy detail loading, and row expansion for run inference records", async () => {
    // Audit traceability: e647687.
    const allRecords = [
      createRecord({
        inferenceId: "inf-1",
        projectId: "project-1" as ProjectId,
        scriptId: "dev-web",
        scriptName: "Dev Web",
        status: "ready",
      }),
      createRecord({
        inferenceId: "inf-2",
        projectId: "project-2" as ProjectId,
        scriptId: "deploy-api",
        scriptName: "Deploy API",
        status: "failed",
      }),
      createRecord({
        inferenceId: "inf-3",
        projectId: "project-2" as ProjectId,
        scriptId: "smoke-tests",
        scriptName: "Smoke Tests",
        status: "ungrounded",
      }),
    ] as const;

    const detailDeferred = createDeferredPromise<ManagedRunInferenceRecordDetail>();
    const listInferenceRecordsSpy = vi.fn<NativeApi["managedRuns"]["listInferenceRecords"]>(
      async (input) =>
        allRecords.filter(
          (record) =>
            (input.projectId === undefined || record.projectId === input.projectId) &&
            (input.scriptId === undefined || record.scriptId === input.scriptId),
        ),
    );
    const getInferenceRecordSpy = vi.fn<NativeApi["managedRuns"]["getInferenceRecord"]>(
      async ({ inferenceId }) => {
        if (inferenceId === "inf-2") {
          return detailDeferred.promise;
        }
        throw new Error(`Unexpected inference detail request for ${inferenceId}`);
      },
    );

    window.nativeApi = {
      managedRuns: {
        listInferenceRecords: listInferenceRecordsSpy,
        getInferenceRecord: getInferenceRecordSpy,
      },
    } as unknown as NativeApi;

    const screen = await render(<RunsSettingsPanel />);

    try {
      await expect.element(page.getByText("Dev Web")).toBeInTheDocument();
      await expect.element(page.getByText("Deploy API")).toBeInTheDocument();
      expect(getInferenceRecordSpy).not.toHaveBeenCalled();

      await selectFilterOption(0, "project-2");
      await vi.waitFor(() => {
        expect(listInferenceRecordsSpy).toHaveBeenLastCalledWith({
          limit: 100,
          projectId: "project-2",
        });
      });
      await expect.element(page.getByText("Deploy API")).toBeInTheDocument();
      await expect.element(page.getByText("Smoke Tests")).toBeInTheDocument();
      await expect.element(page.getByText("Dev Web")).not.toBeInTheDocument();

      await selectFilterOption(1, "deploy-api");
      await vi.waitFor(() => {
        expect(listInferenceRecordsSpy).toHaveBeenLastCalledWith({
          limit: 100,
          projectId: "project-2",
          scriptId: "deploy-api",
        });
      });
      await expect.element(page.getByText("Deploy API")).toBeInTheDocument();
      await expect.element(page.getByText("Smoke Tests")).not.toBeInTheDocument();

      await selectFilterOption(2, "Failed");
      await vi.waitFor(() => {
        expect(listInferenceRecordsSpy).toHaveBeenLastCalledWith({
          limit: 100,
          projectId: "project-2",
          scriptId: "deploy-api",
        });
      });
      await expect.element(page.getByText("Deploy API")).toBeInTheDocument();

      await page.getByText("Deploy API").click();
      await vi.waitFor(() => {
        expect(getInferenceRecordSpy).toHaveBeenCalledWith({ inferenceId: "inf-2" });
      });
      await expect.element(page.getByText("Loading detail…")).toBeInTheDocument();

      detailDeferred.resolve(
        createDetail({
          inferenceId: "inf-2",
          runId: "run-inf-2" as ManagedRunInferenceRecordSummary["runId"],
          projectId: "project-2" as ProjectId,
          scriptId: "deploy-api",
          scriptName: "Deploy API",
          status: "failed",
          inferenceError: "Could not validate backend URL",
          groundingFailures: ["No port match for backend container."],
          evidenceExcerpt: ["Found backend log line with 127.0.0.1:4000."],
        }),
      );

      await expect.element(page.getByText("Run ID")).toBeInTheDocument();
      await expect.element(page.getByText("run-inf-2")).toBeInTheDocument();
      await expect.element(page.getByText("Could not validate backend URL")).toBeInTheDocument();
      await expect
        .element(page.getByText("Found backend log line with 127.0.0.1:4000."))
        .toBeInTheDocument();

      await page.getByText("Deploy API").click();
      await expect.element(page.getByText("Run ID")).not.toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });
});
