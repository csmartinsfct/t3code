import { useCallback, useEffect, useState } from "react";
import type { Label, ProjectId } from "@t3tools/contracts";

import { ensureNativeApi } from "../../nativeApi";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

const LABEL_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface LabelEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  label: Label | null;
  scopeProjectId: ProjectId | null;
}

const LABEL_EDITOR_OVERLAY_ROUTE_KEY = "label-editor";

type LabelEditorResult = { action: "saved" };

export function LabelEditorDialog({
  open,
  onClose,
  onSaved,
  label,
  scopeProjectId,
}: LabelEditorDialogProps) {
  const routed = useRoutedOverlaySurface<LabelEditorResult>({
    open,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    routeKey: LABEL_EDITOR_OVERLAY_ROUTE_KEY,
    params: { label, scopeProjectId },
    presentation: { kind: "dialog" },
    onResult: (result) => {
      if (result.action === "saved") onSaved();
    },
  });

  return (
    <Dialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <DialogPopup>
        <LabelEditorDialogContent
          label={label}
          onCancel={onClose}
          onSaved={onSaved}
          open={routed.domOpen}
          scopeProjectId={scopeProjectId}
        />
      </DialogPopup>
    </Dialog>
  );
}

function LabelEditorDialogContent({
  label,
  onCancel,
  onSaved,
  open,
  scopeProjectId,
}: {
  label: Label | null;
  onCancel: () => void;
  onSaved: () => void;
  open: boolean;
  scopeProjectId: ProjectId | null;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]!);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(label?.name ?? "");
      setColor(label?.color ?? LABEL_COLORS[0]!);
    }
  }, [open, label]);

  const isDirty = label ? name !== label.name || color !== label.color : name.length > 0;

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const api = ensureNativeApi();
      if (label) {
        await api.ticketing.updateLabel({
          id: label.id,
          ...(name !== label.name ? { name: name.trim() as never } : {}),
          ...(color !== label.color ? { color: color as never } : {}),
        });
      } else {
        await api.ticketing.createLabel({
          projectId: scopeProjectId,
          name: name.trim() as never,
          color: color as never,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [name, color, label, scopeProjectId, onSaved]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{label ? "Edit Label" : "New Label"}</DialogTitle>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Label name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Color</label>
            <div className="flex flex-wrap gap-2">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-7 rounded-full transition-all"
                  style={{
                    backgroundColor: c,
                    outline: c === color ? `2px solid ${c}` : "2px solid transparent",
                    outlineOffset: "2px",
                  }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!isDirty || !name.trim() || saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

registerOverlayRoute<{ label?: unknown; scopeProjectId?: unknown }>(
  LABEL_EDITOR_OVERLAY_ROUTE_KEY,
  function LabelEditorOverlayRoute({ message, controller }) {
    return (
      <OverlayRouteDialog>
        <DialogPopup>
          <LabelEditorDialogContent
            label={readLabelParam(message.params.label)}
            onCancel={() => controller.cancel("cancel")}
            onSaved={() => controller.submit({ action: "saved" })}
            open
            scopeProjectId={readProjectIdParam(message.params.scopeProjectId)}
          />
        </DialogPopup>
      </OverlayRouteDialog>
    );
  },
);

function readProjectIdParam(value: unknown): ProjectId | null {
  return typeof value === "string" ? (value as ProjectId) : null;
}

function readLabelParam(value: unknown): Label | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Label>;
  if (typeof candidate.id !== "string") return null;
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.color !== "string") return null;
  return {
    id: candidate.id,
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : null,
    name: candidate.name,
    color: candidate.color,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
  } as Label;
}
