import type { NativeApi } from "@t3tools/contracts";

export interface OrchestrationProjectOption {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export async function getOrchestrationProjectOptions(
  api: Pick<NativeApi, "orchestration">,
): Promise<ReadonlyArray<OrchestrationProjectOption>> {
  const snapshot = await api.orchestration.getStartupSnapshot();

  return snapshot.projects.map((project) => ({
    id: project.id,
    title: project.title,
    workspaceRoot: project.workspaceRoot,
  }));
}
