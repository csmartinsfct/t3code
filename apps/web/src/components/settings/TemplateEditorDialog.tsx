import { useCallback, useEffect, useState } from "react";
import type { ProjectId, Template } from "@t3tools/contracts";

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
import { Textarea } from "../ui/textarea";

interface TemplateEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  template: Template | null;
  scopeProjectId: ProjectId | null;
}

const TEMPLATE_EDITOR_OVERLAY_ROUTE_KEY = "template-editor";

type TemplateEditorResult = { action: "saved" };

export function TemplateEditorDialog({
  open,
  onClose,
  onSaved,
  template,
  scopeProjectId,
}: TemplateEditorDialogProps) {
  const routed = useRoutedOverlaySurface<TemplateEditorResult>({
    open,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    routeKey: TEMPLATE_EDITOR_OVERLAY_ROUTE_KEY,
    params: { scopeProjectId, template },
    presentation: { kind: "dialog" },
    onResult: (result) => {
      if (result.action === "saved") onSaved();
    },
  });

  return (
    <Dialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <DialogPopup>
        <TemplateEditorDialogContent
          open={routed.domOpen}
          onCancel={onClose}
          onSaved={onSaved}
          scopeProjectId={scopeProjectId}
          template={template}
        />
      </DialogPopup>
    </Dialog>
  );
}

function TemplateEditorDialogContent({
  onCancel,
  onSaved,
  open,
  scopeProjectId,
  template,
}: {
  open: boolean;
  onCancel: () => void;
  onSaved: () => void;
  scopeProjectId: ProjectId | null;
  template: Template | null;
}) {
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
    <>
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
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!isDirty || !name.trim() || !body.trim() || saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

registerOverlayRoute<{ scopeProjectId?: unknown; template?: unknown }>(
  TEMPLATE_EDITOR_OVERLAY_ROUTE_KEY,
  function TemplateEditorOverlayRoute({ message, controller }) {
    return (
      <OverlayRouteDialog>
        <DialogPopup>
          <TemplateEditorDialogContent
            open
            onCancel={() => controller.cancel("cancel")}
            onSaved={() => controller.submit({ action: "saved" })}
            scopeProjectId={readProjectIdParam(message.params.scopeProjectId)}
            template={readTemplateParam(message.params.template)}
          />
        </DialogPopup>
      </OverlayRouteDialog>
    );
  },
);

function readProjectIdParam(value: unknown): ProjectId | null {
  return typeof value === "string" ? (value as ProjectId) : null;
}

function readTemplateParam(value: unknown): Template | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Template>;
  if (typeof candidate.id !== "string") return null;
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.body !== "string") return null;
  return {
    id: candidate.id,
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : null,
    name: candidate.name,
    description: typeof candidate.description === "string" ? candidate.description : null,
    body: candidate.body,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
  } as Template;
}
