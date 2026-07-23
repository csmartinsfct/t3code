import { useState, useCallback, memo } from "react";
import { CheckIcon, ClockIcon, XIcon } from "lucide-react";

import type { ProposeScheduledTaskPayload } from "../../lib/proposeScheduledTaskParser";
import type { OrchestrationProjectOption } from "../../lib/orchestrationProjectOptions";
import { useOrchestrationProjectOptions } from "../../hooks/useOrchestrationProjectOptions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ProviderCapabilityIcon } from "./ProviderCapabilityIcon";

export interface ProposeScheduledTaskCardProps {
  name: string;
  description: string | null;
  cronExpression: string;
  projectId: string;
  skillIds?: string[];
  providerCapabilities?: ProposeScheduledTaskPayload["providerCapabilities"];
  prompt?: string;
  autoSend: boolean;
  modelSelection?: ProposeScheduledTaskPayload["modelSelection"];
  projectName: string;
  isStreaming: boolean;
  onAccept: (data: ProposeScheduledTaskPayload) => void;
  onReject: () => void;
}

function ProposeScheduledTaskCard({
  name: initialName,
  description: initialDescription,
  cronExpression: initialCron,
  projectId: initialProjectId,
  skillIds,
  providerCapabilities,
  prompt: initialPrompt,
  autoSend,
  modelSelection,
  projectName: initialProjectName,
  isStreaming,
  onAccept,
  onReject,
}: ProposeScheduledTaskCardProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [cronExpression, setCronExpression] = useState(initialCron);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");
  const storeProjectOptions = useOrchestrationProjectOptions();
  const projects: ReadonlyArray<OrchestrationProjectOption> =
    storeProjectOptions.length > 0
      ? storeProjectOptions
      : [{ id: initialProjectId, title: initialProjectName, workspaceRoot: "" }];

  const disabled = isStreaming || status !== "pending";

  const selectedProjectName = projects.find((p) => p.id === projectId)?.title ?? projectId;

  const handleAccept = useCallback(() => {
    if (isStreaming || status !== "pending") return;
    setStatus("accepted");
    onAccept({
      name: name.trim(),
      description: description.trim() || null,
      cronExpression: cronExpression.trim(),
      projectId,
      ...(skillIds && skillIds.length > 0 ? { skillIds } : {}),
      ...(providerCapabilities && providerCapabilities.length > 0 ? { providerCapabilities } : {}),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      autoSend,
      ...(modelSelection ? { modelSelection } : {}),
    });
  }, [
    isStreaming,
    status,
    name,
    description,
    cronExpression,
    projectId,
    skillIds,
    providerCapabilities,
    prompt,
    autoSend,
    modelSelection,
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
        <span>Proposed Scheduled Task</span>
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
        {((skillIds && skillIds.length > 0) ||
          (providerCapabilities && providerCapabilities.length > 0) ||
          autoSend ||
          modelSelection) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {skillIds && skillIds.length > 0 && <span>Skills: {skillIds.join(", ")}</span>}
            {providerCapabilities?.map((capability) => (
              <span
                key={`${capability.provider}:${capability.kind}:${capability.id}`}
                className="flex items-center gap-1"
              >
                <ProviderCapabilityIcon capability={capability} className="size-3" />
                {capability.displayName}
              </span>
            ))}
            {autoSend && <span>Auto send enabled</span>}
            {modelSelection && <span>Model: {modelSelection.model}</span>}
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

export default memo(ProposeScheduledTaskCard);
