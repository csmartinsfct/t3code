import { useCallback, useEffect, useState } from "react";
import type { Label, ProjectId } from "@t3tools/contracts";

import { ensureNativeApi } from "../../nativeApi";
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

export function LabelEditorDialog({
  open,
  onClose,
  onSaved,
  label,
  scopeProjectId,
}: LabelEditorDialogProps) {
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup>
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!isDirty || !name.trim() || saving} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
