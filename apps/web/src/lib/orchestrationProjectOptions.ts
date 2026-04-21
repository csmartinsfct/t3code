import type { NativeApi } from "@t3tools/contracts";
import type { Project } from "../types";

export interface OrchestrationProjectOption {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export function mapProjectsToOrchestrationProjectOptions(
  projects: ReadonlyArray<Pick<Project, "id" | "name" | "cwd">>,
): ReadonlyArray<OrchestrationProjectOption> {
  return projects.map((project) => ({
    id: project.id,
    title: project.name,
    workspaceRoot: project.cwd,
  }));
}

export async function getOrchestrationProjectOptions(
  api: Pick<NativeApi, "orchestration">,
): Promise<ReadonlyArray<OrchestrationProjectOption>> {
  const projects = await api.orchestration.listProjects();

  return projects.map((project) => ({
    id: project.id,
    title: project.title,
    workspaceRoot: project.workspaceRoot,
  }));
}
