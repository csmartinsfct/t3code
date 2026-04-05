import type { DeclaredService, ProjectScriptIcon, ServiceHealthCheck } from "@t3tools/contracts";

const PROPOSE_ACTION_LANGUAGE = "language-t3:propose-action";

const VALID_ICONS = new Set<string>(["play", "test", "lint", "configure", "build", "debug"]);

const VALID_HEALTH_CHECK_TYPES = new Set<string>(["url", "docker", "port", "command"]);

export interface ProposeActionPayload {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  services?: DeclaredService[];
}

/**
 * Check whether a code block's className indicates a `t3:propose-action` block.
 */
export function isProposeActionBlock(className: string | undefined): boolean {
  return className?.includes(PROPOSE_ACTION_LANGUAGE) === true;
}

/**
 * Validate and parse a service health check from raw JSON.
 */
function parseHealthCheck(raw: unknown): ServiceHealthCheck | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const check = raw as Record<string, unknown>;
  const type = typeof check.type === "string" ? check.type : "";
  if (!VALID_HEALTH_CHECK_TYPES.has(type)) return null;

  switch (type) {
    case "url": {
      const url = typeof check.url === "string" ? check.url.trim() : "";
      if (!url) return null;
      return { type: "url", url } as ServiceHealthCheck;
    }
    case "docker": {
      const container = typeof check.container === "string" ? check.container.trim() : "";
      if (!container) return null;
      return { type: "docker", container } as ServiceHealthCheck;
    }
    case "port": {
      const port = typeof check.port === "number" ? check.port : 0;
      if (port <= 0 || port > 65535) return null;
      const host = typeof check.host === "string" ? check.host.trim() : undefined;
      return { type: "port", port, ...(host ? { host } : {}) } as ServiceHealthCheck;
    }
    case "command": {
      const command = typeof check.command === "string" ? check.command.trim() : "";
      if (!command) return null;
      const cwd = typeof check.cwd === "string" ? check.cwd.trim() : undefined;
      return { type: "command", command, ...(cwd ? { cwd } : {}) } as ServiceHealthCheck;
    }
    default:
      return null;
  }
}

/**
 * Parse declared services from raw JSON array.
 */
function parseServices(raw: unknown): DeclaredService[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const services: DeclaredService[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const healthCheck = parseHealthCheck(record.healthCheck);
    if (!healthCheck) continue;
    services.push({ name, healthCheck } as DeclaredService);
  }

  return services.length > 0 ? services : undefined;
}

/**
 * Safely parse a propose-action JSON payload from a code block.
 * Returns null for incomplete (streaming), empty, or malformed content.
 */
export function parseProposeActionPayload(code: string): ProposeActionPayload | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const command = typeof record.command === "string" ? record.command.trim() : "";

    if (name.length === 0 || command.length === 0) {
      return null;
    }

    const rawIcon = typeof record.icon === "string" ? record.icon : "play";
    const icon: ProjectScriptIcon = (
      VALID_ICONS.has(rawIcon) ? rawIcon : "play"
    ) as ProjectScriptIcon;

    const services = parseServices(record.services);

    return { name, command, icon, ...(services ? { services } : {}) };
  } catch {
    // Incomplete JSON during streaming, or genuinely malformed
    return null;
  }
}
