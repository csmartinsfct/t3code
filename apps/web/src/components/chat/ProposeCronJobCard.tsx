import { useState, useCallback, useEffect, memo } from "react";
import { CheckIcon, ClockIcon, XIcon } from "lucide-react";

import type { ProposeCronJobPayload } from "../../lib/proposeCronJobParser";
import { ensureNativeApi } from "../../nativeApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

export interface ProposeCronJobCardProps {
  name: string;
  description: string | null;
  cronExpression: string;
  projectId: string;
  skillId?: string;
  prompt?: string;
  autoSend: boolean;
  projectName: string;
  isStreaming: boolean;
  onAccept: (data: ProposeCronJobPayload) => void;
  onReject: () => void;
}

function ProposeCronJobCard({
  name: initialName,
  description: initialDescription,
  cronExpression: initialCron,
  projectId: initialProjectId,
  skillId,
  prompt: initialPrompt,
  autoSend,
  projectName: initialProjectName,
  isStreaming,
  onAccept,
  onReject,
}: ProposeCronJobCardProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [cronExpression, setCronExpression] = useState(initialCron);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");
  const [projects, setProjects] = useState<ReadonlyArray<{ id: string; title: string }>>([
    { id: initialProjectId, title: initialProjectName },
  ]);

  const disabled = isStreaming || status !== "pending";

  useEffect(() => {
    void ensureNativeApi()
      .orchestration.getSnapshot()
      .then((snapshot) => {
        const mapped = snapshot.projects.map((p) => ({ id: p.id, title: p.title }));
        if (mapped.length > 0) setProjects(mapped);
      })
      .catch(() => {});
  }, []);

  const selectedProjectName = projects.find((p) => p.id === projectId)?.title ?? projectId;

  const handleAccept = useCallback(() => {
    if (isStreaming || status !== "pending") return;
    setStatus("accepted");
    onAccept({
      name: name.trim(),
      description: description.trim() || null,
      cronExpression: cronExpression.trim(),
      projectId,
      ...(skillId ? { skillId } : {}),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      autoSend,
    });
  }, [
    isStreaming,
    status,
    name,
    description,
    cronExpression,
    projectId,
    skillId,
    prompt,
    autoSend,
    onAccept,
  ]);

  const handleReject = useCallback(() => {
    if (isStreaming || status !== "pending") return;
    setStatus("rejected");
    onReject();
  }, [isStreaming, status, onReject]);

  return (
    <div
      className="my-2 rounded-lg border border-border/70 bg-muted/30 p-3"
      data-scroll-anchor-ignore
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ClockIcon className="size-3.5" />
        <span>Proposed Cron Job</span>
        {status === "accepted" && (
          <Badge variant="outline" className="ml-auto text-[10px] text-green-600">
            Added
          </Badge>
        )}
        {status === "rejected" && (
          <Badge variant="outline" className="ml-auto text-[10px] text-red-500">
            Rejected
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        {/* Name */}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          placeholder="Job name"
          className="h-8 text-sm"
        />

        {/* Description */}
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={disabled}
          placeholder="Description (optional)"
          className="h-8 text-xs"
        />

        {/* Schedule */}
        <Input
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          disabled={disabled}
          placeholder="Cron expression (e.g. 0 9 * * *)"
          className="h-8 font-mono text-xs"
        />

        {/* Project selector */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Project
          </span>
          {disabled ? (
            <span className="text-xs text-foreground/80">{selectedProjectName}</span>
          ) : (
            <Select value={projectId} onValueChange={(val) => setProjectId(val ?? projectId)}>
              <SelectTrigger size="xs" className="w-full">
                <SelectValue>{selectedProjectName}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {projects.map((project) => (
                  <SelectItem hideIndicator key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
        </div>

        {/* Metadata row */}
        {(skillId || autoSend) && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {skillId && <span>Skill: {skillId}</span>}
            {skillId && autoSend && <span className="text-border">|</span>}
            {autoSend && <span>Auto send enabled</span>}
          </div>
        )}

        {/* Prompt */}
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled}
          placeholder="Prompt (optional)"
          rows={2}
          className="resize-none text-xs"
        />

        {/* Actions */}
        {!isStreaming && status === "pending" && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              size="xs"
              variant="outline"
              onClick={handleReject}
              className="gap-1 text-muted-foreground"
            >
              <XIcon className="size-3" />
              Reject
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={handleAccept}
              disabled={name.trim().length === 0 || cronExpression.trim().length === 0}
              className="gap-1"
            >
              <CheckIcon className="size-3" />
              Accept
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ProposeCronJobCard);
