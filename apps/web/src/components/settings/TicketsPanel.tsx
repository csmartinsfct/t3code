import { useCallback, useEffect, useState } from "react";
import { LoaderIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Label, ProjectId, Template } from "@t3tools/contracts";

import { ensureNativeApi } from "../../nativeApi";
import { useStore } from "../../store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsSection } from "./SettingsPanels";
import { LabelEditorDialog } from "./LabelEditorDialog";
import { TemplateEditorDialog } from "./TemplateEditorDialog";

type ScopeKind = "global" | "project";

export function TicketsPanel() {
  const projects = useStore((s) => s.projects);

  const [scopeKind, setScopeKind] = useState<ScopeKind>("global");
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const [labels, setLabels] = useState<ReadonlyArray<Label>>([]);
  const [templates, setTemplates] = useState<ReadonlyArray<Template>>([]);
  const [loading, setLoading] = useState(true);

  // Label editor state
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);

  // Template editor state
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

  const scopeProjectId = scopeKind === "project" && selectedProjectId ? selectedProjectId : null;
  const scopeValue = scopeProjectId ?? "global";

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const api = ensureNativeApi();
      const [labelResult, templateResult] = await Promise.all([
        api.ticketing.listLabels({ projectId: scopeProjectId }),
        api.ticketing.listTemplates({ projectId: scopeProjectId }),
      ]);
      setLabels(labelResult);
      setTemplates(templateResult);
    } finally {
      setLoading(false);
    }
  }, [scopeProjectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Real-time updates
  useEffect(() => {
    const api = ensureNativeApi();
    const unsub = api.ticketing.onEvent((event) => {
      if (event.type === "label_upserted") {
        setLabels((prev) => {
          const idx = prev.findIndex((l) => l.id === event.label.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = event.label;
            return next;
          }
          return [...prev, event.label];
        });
      } else if (event.type === "label_deleted") {
        setLabels((prev) => prev.filter((l) => l.id !== event.labelId));
      } else if (event.type === "template_upserted") {
        setTemplates((prev) => {
          const idx = prev.findIndex((t) => t.id === event.template.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = event.template;
            return next;
          }
          return [...prev, event.template];
        });
      } else if (event.type === "template_deleted") {
        setTemplates((prev) => prev.filter((t) => t.id !== event.templateId));
      }
    });
    return unsub;
  }, []);

  const handleScopeChange = useCallback((value: string | null) => {
    if (!value || value === "global") {
      setScopeKind("global");
      setSelectedProjectId(null);
    } else {
      setScopeKind("project");
      setSelectedProjectId(value as ProjectId);
    }
  }, []);

  const handleDeleteLabel = useCallback(
    async (label: Label) => {
      const api = ensureNativeApi();
      const confirmed = await api.dialogs.confirm(
        `Delete label "${label.name}"?\n\nThis will remove the label from all tickets that use it.`,
      );
      if (confirmed) {
        await api.ticketing.deleteLabel({ id: label.id });
        void loadData();
      }
    },
    [loadData],
  );

  const handleDeleteTemplate = useCallback(
    async (template: Template) => {
      const api = ensureNativeApi();
      const confirmed = await api.dialogs.confirm(`Delete template "${template.name}"?`);
      if (confirmed) {
        await api.ticketing.deleteTemplate({ id: template.id });
        void loadData();
      }
    },
    [loadData],
  );

  const handleLabelEditorSaved = useCallback(() => {
    setLabelEditorOpen(false);
    setEditingLabel(null);
    void loadData();
  }, [loadData]);

  const handleTemplateEditorSaved = useCallback(() => {
    setTemplateEditorOpen(false);
    setEditingTemplate(null);
    void loadData();
  }, [loadData]);

  // Filter labels/templates shown based on scope
  const filteredLabels = scopeProjectId ? labels : labels.filter((l) => l.projectId === null);
  const filteredTemplates = scopeProjectId
    ? templates
    : templates.filter((t) => t.projectId === null);

  return (
    <SettingsPageContainer>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">Scope</span>
          <Select value={scopeValue} onValueChange={handleScopeChange}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Ticket settings scope">
              <SelectValue>
                {scopeKind === "global"
                  ? "Global"
                  : (projects.find((p) => p.id === selectedProjectId)?.name ?? "Project")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="global">
                Global
              </SelectItem>
              {projects.map((project) => (
                <SelectItem hideIndicator key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <SettingsSection
            title="Labels"
            headerAction={
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setEditingLabel(null);
                  setLabelEditorOpen(true);
                }}
              >
                <PlusIcon className="size-3" />
                Add Label
              </Button>
            }
          >
            {filteredLabels.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No labels yet.
              </div>
            ) : (
              filteredLabels.map((label) => (
                <div
                  key={label.id}
                  className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {label.name}
                      </span>
                      {scopeProjectId && label.projectId === null ? (
                        <Badge variant="info" size="sm">
                          Global
                        </Badge>
                      ) : scopeProjectId && label.projectId !== null ? (
                        <Badge variant="warning" size="sm">
                          Project
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Edit label"
                        className="size-6 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingLabel(label);
                          setLabelEditorOpen(true);
                        }}
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Delete label"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDeleteLabel(label)}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </SettingsSection>

          <SettingsSection
            title="Description Templates"
            headerAction={
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateEditorOpen(true);
                }}
              >
                <PlusIcon className="size-3" />
                Add Template
              </Button>
            }
          >
            {filteredTemplates.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No templates yet.
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {template.name}
                        </span>
                        {scopeProjectId && template.projectId === null ? (
                          <Badge variant="info" size="sm">
                            Global
                          </Badge>
                        ) : scopeProjectId && template.projectId !== null ? (
                          <Badge variant="warning" size="sm">
                            Project
                          </Badge>
                        ) : null}
                      </div>
                      {template.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {template.description}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Edit template"
                        className="size-6 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingTemplate(template);
                          setTemplateEditorOpen(true);
                        }}
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Delete template"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDeleteTemplate(template)}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </SettingsSection>
        </>
      )}

      <LabelEditorDialog
        open={labelEditorOpen}
        onClose={() => {
          setLabelEditorOpen(false);
          setEditingLabel(null);
        }}
        onSaved={handleLabelEditorSaved}
        label={editingLabel}
        scopeProjectId={scopeProjectId}
      />

      <TemplateEditorDialog
        open={templateEditorOpen}
        onClose={() => {
          setTemplateEditorOpen(false);
          setEditingTemplate(null);
        }}
        onSaved={handleTemplateEditorSaved}
        template={editingTemplate}
        scopeProjectId={scopeProjectId}
      />
    </SettingsPageContainer>
  );
}
