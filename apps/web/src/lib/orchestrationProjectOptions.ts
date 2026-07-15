import type { NativeApi } from "@t3tools/contracts";
import type { Project } from "../types";
import { formatProjectName } from "../projectName";

export interface OrchestrationProjectOption {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export function mapProjectsToOrchestrationProjectOptions(
  projects: ReadonlyArray<Pick<Project, "id" | "name" | "nameHidden" | "cwd">>,
): ReadonlyArray<OrchestrationProjectOption> {
  return projects.map((project) => ({
    id: project.id,
    title: formatProjectName(project.name, project.nameHidden),
    workspaceRoot: project.cwd,
  }));
}

export async function getOrchestrationProjectOptions(
  api: Pick<NativeApi, "orchestration">,
): Promise<ReadonlyArray<OrchestrationProjectOption>> {
  const projects = await api.orchestration.listProjects();

  return projects.map((project) => ({
    id: project.id,
    title: formatProjectName(project.title, project.nameHidden),
    workspaceRoot: project.workspaceRoot,
  }));
}
