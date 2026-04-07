import { SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { readNativeApi } from "../nativeApi";
import { newCommandId } from "../lib/utils";
import type { Project } from "../types";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { Spinner } from "./ui/spinner";

interface SystemPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
}

export function SystemPromptDialog({ open, onOpenChange, project }: SystemPromptDialogProps) {
  const [promptText, setPromptText] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && project) {
      setPromptText(project.systemPrompt ?? "");
    }
  }, [open, project]);

  const handleEnhance = useCallback(async () => {
    if (!project || !promptText.trim()) return;
    const api = readNativeApi();
    if (!api) return;

    setEnhancing(true);
    try {
      const result = await api.projects.enhanceSystemPrompt({
        projectId: project.id,
        currentPrompt: promptText.trim(),
      });
      setPromptText(result.enhancedPrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enhance prompt.";
      toastManager.add({
        type: "error",
        title: "Enhancement failed",
        description: message,
      });
    } finally {
      setEnhancing(false);
    }
  }, [project, promptText]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    const api = readNativeApi();
    if (!api) return;

    setSaving(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: project.id,
        systemPrompt: promptText.trim() || null,
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save system prompt.";
      toastManager.add({
        type: "error",
        title: "Save failed",
        description: message,
      });
    } finally {
      setSaving(false);
    }
  }, [project, promptText, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>System Prompt</DialogTitle>
          <DialogDescription>
            Custom instructions appended to every AI session in{" "}
            <span className="font-medium text-foreground">{project?.name}</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Textarea
            className="font-mono"
            size="lg"
            placeholder="e.g. Always use TypeScript strict mode. Prefer functional patterns..."
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={10}
            disabled={enhancing}
          />
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEnhance}
            disabled={!promptText.trim() || enhancing || saving}
            className="sm:mr-auto"
          >
            {enhancing ? <Spinner className="size-3.5" /> : <SparklesIcon className="size-3.5" />}
            {enhancing ? "Enhancing..." : "Enhance prompt"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner className="size-3.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
