import type { DeclaredService, ProjectScriptIcon } from "@t3tools/contracts";

const PROPOSE_ACTION_LANGUAGE = "language-t3:propose-action";

const VALID_ICONS = new Set<string>(["play", "test", "lint", "configure", "build", "debug"]);

export interface ProposeActionPayload {
  name: string;
  /** Empty for composite actions where every entry in `services` has its own command. */
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

function parseServiceEnv(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(record)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 128) continue;
    if (typeof value !== "string" || value.length > 8_192) continue;
    out[key] = value;
    count += 1;
    if (count >= 128) break;
  }
  return count > 0 ? out : undefined;
}

/**
 * Parse declared services from raw JSON array. Health checks are no longer
 * authored by the AI — T3 infers them from logs at runtime.
 */
function parseServices(raw: unknown): DeclaredService[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const services: DeclaredService[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const serviceCommand = typeof record.command === "string" ? record.command.trim() : "";
    const serviceCwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
    const serviceEnv = parseServiceEnv(record.env);
    services.push({
      name,
      ...(serviceCommand.length > 0 ? { command: serviceCommand } : {}),
      ...(serviceCwd.length > 0 ? { cwd: serviceCwd } : {}),
      ...(serviceEnv ? { env: serviceEnv } : {}),
    } satisfies DeclaredService);
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

    if (name.length === 0) {
      return null;
    }

    const rawIcon = typeof record.icon === "string" ? record.icon : "play";
    const icon: ProjectScriptIcon = (
      VALID_ICONS.has(rawIcon) ? rawIcon : "play"
    ) as ProjectScriptIcon;

    const services = parseServices(record.services);

    // Valid if EITHER top-level command is set (legacy) OR every parsed service
    // carries its own command (composite). Streaming partials with neither are
    // null until at least one command shows up.
    const everyServiceHasCommand =
      services !== undefined &&
      services.length > 0 &&
      services.every((s) => typeof s.command === "string" && s.command.length > 0);
    if (command.length === 0 && !everyServiceHasCommand) {
      return null;
    }
    // Mixed shape (top-level command AND every-service command) is invalid —
    // drop the top-level command and treat the proposal as composite. This
    // mirrors `validateProjectScriptShape` server-side.
    const sanitizedCommand = everyServiceHasCommand ? "" : command;

    return { name, command: sanitizedCommand, icon, ...(services ? { services } : {}) };
  } catch {
    // Incomplete JSON during streaming, or genuinely malformed
    return null;
  }
}
