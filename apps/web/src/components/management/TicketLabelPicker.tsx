import type { Label, LabelId, ProjectId, TicketId } from "@t3tools/contracts";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

// ── Preset palette for new labels ────────────────────────────────────

const LABEL_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

function pickNewLabelColor(existing: readonly Label[]): string {
  const used = new Set(existing.map((l) => l.color));
  return (
    LABEL_COLORS.find((c) => !used.has(c)) ??
    LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)]!
  );
}

// ── Pure helpers (testable) ──────────────────────────────────────────

export function filterLabels(labels: readonly Label[], query: string): readonly Label[] {
  const q = query.trim().toLowerCase();
  if (!q) return labels;
  return labels.filter((l) => l.name.toLowerCase().includes(q));
}

export function isLabelAttached(attachedIds: ReadonlySet<string>, labelId: string): boolean {
  return attachedIds.has(labelId);
}

// ── Component ────────────────────────────────────────────────────────

interface TicketLabelPickerProps {
  ticketId: TicketId;
  projectId: string;
  labels: readonly Label[];
  onUpdated: () => void;
}

export function TicketLabelPicker({
  ticketId,
  projectId,
  labels,
  onUpdated,
}: TicketLabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [allLabels, setAllLabels] = useState<readonly Label[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const attachedIds = useMemo(() => new Set(labels.map((l) => l.id as string)), [labels]);

  const fetchLabels = useCallback(async () => {
    try {
      const api = ensureNativeApi();
      const result = await api.ticketing.listLabels({
        projectId: projectId as ProjectId,
      });
      setAllLabels(result);
    } catch (error) {
      console.error("Failed to fetch labels:", error);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      void fetchLabels();
      setSearch("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, fetchLabels]);

  const filtered = useMemo(() => filterLabels(allLabels, search), [allLabels, search]);

  const handleToggleLabel = useCallback(
    async (label: Label) => {
      try {
        const api = ensureNativeApi();
        const input = { ticketId, labelId: label.id };
        if (isLabelAttached(attachedIds, label.id as string)) {
          await api.ticketing.removeTicketLabel(input);
        } else {
          await api.ticketing.addTicketLabel(input);
        }
        onUpdated();
      } catch (error) {
        console.error("Failed to toggle label:", error);
      }
    },
    [ticketId, attachedIds, onUpdated],
  );

  const handleRemoveLabel = useCallback(
    async (labelId: LabelId) => {
      try {
        const api = ensureNativeApi();
        await api.ticketing.removeTicketLabel({ ticketId, labelId });
        onUpdated();
      } catch (error) {
        console.error("Failed to remove label:", error);
      }
    },
    [ticketId, onUpdated],
  );

  const handleCreateLabel = useCallback(async () => {
    const name = search.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const api = ensureNativeApi();
      const color = pickNewLabelColor(allLabels);
      const label = await api.ticketing.createLabel({
        projectId: projectId as ProjectId,
        name: name as never,
        color: color as never,
      });
      await api.ticketing.addTicketLabel({ ticketId, labelId: label.id });
      setSearch("");
      onUpdated();
      void fetchLabels();
    } catch (error) {
      console.error("Failed to create label:", error);
    } finally {
      setCreating(false);
    }
  }, [search, creating, allLabels, projectId, ticketId, onUpdated, fetchLabels]);

  const exactNameExists = useMemo(
    () => allLabels.some((l) => l.name.toLowerCase() === search.trim().toLowerCase()),
    [allLabels, search],
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">Labels</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Add button — always first */}
        <Menu open={open} onOpenChange={setOpen}>
          <MenuTrigger
            className="inline-flex size-5 items-center justify-center rounded-sm border border-dashed border-muted-foreground/25 text-muted-foreground/50 transition-colors hover:border-muted-foreground/40 hover:text-muted-foreground/80"
            aria-label="Add label"
          >
            <PlusIcon className="size-3" />
          </MenuTrigger>
          <MenuPopup align="start">
            {/* Search input */}
            <div className="px-2">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && search.trim() && !exactNameExists) {
                    void handleCreateLabel();
                  }
                }}
                placeholder="Search or create"
                className="w-full bg-transparent text-base font-normal text-foreground outline-none placeholder:text-muted-foreground/50 sm:text-sm"
              />
            </div>
            <MenuSeparator />

            {filtered.map((label) => {
              const attached = isLabelAttached(attachedIds, label.id as string);
              return (
                <MenuItem
                  key={label.id}
                  closeOnClick={false}
                  onClick={() => void handleToggleLabel(label)}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 truncate">{label.name}</span>
                  {attached && <CheckIcon className="size-3 shrink-0 opacity-80" />}
                </MenuItem>
              );
            })}
            {/* Create new */}
            {search.trim() && !exactNameExists && (
              <>
                {filtered.length > 0 && <MenuSeparator />}
                <MenuItem
                  closeOnClick={false}
                  onClick={() => void handleCreateLabel()}
                  disabled={creating}
                >
                  <PlusIcon className="size-3 shrink-0" />
                  <span className="text-muted-foreground">
                    Create <span className="font-medium text-foreground">{search.trim()}</span>
                  </span>
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>

        {/* Attached labels */}
        {labels.map((label) => (
          <span
            key={label.id}
            className="group/label inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: `${label.color}14`,
              color: label.color,
            }}
          >
            {label.name}
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/label:opacity-70 hover:group-hover/label:opacity-100"
              onClick={() => void handleRemoveLabel(label.id)}
              aria-label={`Remove label ${label.name}`}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
