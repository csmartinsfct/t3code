import type { TicketPriority, TicketStatus } from "@t3tools/contracts";
import { PlusIcon, XIcon } from "lucide-react";
import { useCallback, useId, useState } from "react";

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
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ALL_PRIORITIES, ALL_STATUSES, PRIORITY_CONFIG, STATUS_CONFIG } from "./ticketUtils";

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function CreateTicketDialog({ open, onOpenChange, projectId }: CreateTicketDialogProps) {
  const formId = useId();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TicketStatus>("backlog");
  const [priority, setPriority] = useState<TicketPriority>("none");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setTitle("");
    setStatus("backlog");
    setPriority("none");
    setDescription("");
    setCriteria([]);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;
      setSaving(true);
      try {
        const api = ensureNativeApi();
        const acceptanceCriteria = criteria
          .filter((c) => c.trim())
          .map((text) => ({ text, status: "pending" as const }));
        await api.ticketing.create({
          projectId: projectId as never,
          title: title.trim(),
          status,
          priority,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
        });
        resetForm();
        onOpenChange(false);
      } catch (error) {
        console.error("Failed to create ticket:", error);
      } finally {
        setSaving(false);
      }
    },
    [title, status, priority, description, criteria, projectId, resetForm, onOpenChange],
  );

  const addCriterion = useCallback(() => {
    setCriteria((prev) => [...prev, ""]);
  }, []);

  const updateCriterion = useCallback((index: number, value: string) => {
    setCriteria((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const removeCriterion = useCallback((index: number) => {
    setCriteria((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <form id={formId} className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-title" className="text-xs font-medium">
                Title
              </Label>
              <Input
                id="ticket-title"
                size="sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TicketStatus)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <div className="flex items-center gap-2">
                          <div className={`size-2 rounded-full ${STATUS_CONFIG[s].dotClass}`} />
                          {STATUS_CONFIG[s].label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {ALL_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        <div className="flex items-center gap-2">
                          <div className={`size-2 rounded-full ${PRIORITY_CONFIG[p].dotClass}`} />
                          {PRIORITY_CONFIG[p].label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-desc" className="text-xs font-medium">
                Description
              </Label>
              <Textarea
                id="ticket-desc"
                size="sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details..."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium">Acceptance Criteria</Label>
              {criteria.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {criteria.map((text, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        size="sm"
                        value={text}
                        onChange={(e) => updateCriterion(i, e.target.value)}
                        placeholder={`Criterion ${i + 1}`}
                        className="flex-1"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                        onClick={() => removeCriterion(i)}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="flex w-fit items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={addCriterion}
              >
                <PlusIcon className="size-3" />
                Add criterion
              </button>
            </div>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={formId} disabled={!title.trim() || saving}>
            {saving ? "Creating..." : "Create task"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
