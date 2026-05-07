import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  Gemini,
  IntelliJIdeaIcon,
  OpenAI,
  TraeIcon,
  VisualStudioCode,
  Zed,
} from "../Icons";

// Maps Lucide component name strings (e.g. "Pencil", "Trash2") to the
// actual icon component. Used by overlay menu items where icons must be
// serialized over IPC as strings. The registry is built lazily so only
// icons actually used at runtime are loaded.
const registry = new Proxy({} as Record<string, LucideIcon>, {
  get(_target, name: string) {
    return (Icons as unknown as Record<string, LucideIcon>)[name] ?? null;
  },
});

interface OverlayIconProps {
  name: string;
  className?: string | undefined;
}

export function OverlayIcon({ name, className }: OverlayIconProps) {
  if (name === "provider:codex") return <OpenAI className={className} />;
  if (name === "provider:claudeAgent") return <ClaudeAI className={className} />;
  if (name === "provider:gemini") return <Gemini className={className} />;
  if (name === "provider:cursor") return <CursorIcon className={className} />;
  if (name === "editor:cursor") return <CursorIcon className={className} />;
  if (name === "editor:trae") return <TraeIcon className={className} />;
  if (name === "editor:vscode") return <VisualStudioCode className={className} />;
  if (name === "editor:vscode-insiders") return <VisualStudioCode className={className} />;
  if (name === "editor:vscodium") return <VisualStudioCode className={className} />;
  if (name === "editor:zed") return <Zed className={className} />;
  if (name === "editor:antigravity") return <AntigravityIcon className={className} />;
  if (name === "editor:idea") return <IntelliJIdeaIcon className={className} />;

  const Icon = registry[name];
  if (!Icon) return null;
  return <Icon className={className} />;
}
