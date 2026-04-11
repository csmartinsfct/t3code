import { useCallback, useEffect, useState } from "react";
import type { ProjectId, Template } from "@t3tools/contracts";

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
import { Textarea } from "../ui/textarea";

interface TemplateEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  template: Template | null;
  scopeProjectId: ProjectId | null;
}

export function TemplateEditorDialog({
  open,
  onClose,
  onSaved,
  template,
  scopeProjectId,
}: TemplateEditorDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setBody(template?.body ?? "");
    }
  }, [open, template]);

  const isDirty = template
    ? name !== template.name ||
      (description || "") !== (template.description || "") ||
      body !== template.body
    : name.length > 0 || body.length > 0;

  const handleSave = useCallback(async () => {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const api = ensureNativeApi();
      if (template) {
        await api.ticketing.updateTemplate({
          id: template.id,
          ...(name !== template.name ? { name: name.trim() as never } : {}),
          ...((description || "") !== (template.description || "")
            ? { description: description.trim() || null }
            : {}),
          ...(body !== template.body ? { body } : {}),
        });
      } else {
        await api.ticketing.createTemplate({
          projectId: scopeProjectId,
          name: name.trim() as never,
          description: description.trim() || null,
          body,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [name, description, body, template, scopeProjectId, onSaved]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{template ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Description (optional)
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description of the template"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Body (Markdown)</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="## Section heading&#10;&#10;Description..."
                className="min-h-[200px] font-mono text-xs"
              />
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!isDirty || !name.trim() || !body.trim() || saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
