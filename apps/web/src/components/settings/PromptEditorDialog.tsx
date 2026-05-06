import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  CanonicalPromptVariableKey,
  PromptDefinitionConstraints,
  PromptDocumentV1,
  PromptId,
  PreviewPromptDocumentResult,
  PromptDocumentState,
  PromptDocumentValidationResult,
  PromptManagementScope,
  PromptTemplateBlock,
  PromptTemplateVariableDefinition,
  RuntimeMatch,
} from "@t3tools/contracts";

import { ensureNativeApi } from "../../nativeApi";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";

// ── Types ──────────────────────────────────────────────────────────────

interface EditorBlock {
  id: string;
  when: PromptTemplateBlock["when"];
  text: string;
}

interface PromptEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  documentState: PromptDocumentState | null;
  scopeInput: PromptManagementScope;
  /** When provided, Save writes locally instead of calling the prompt update API. */
  onLocalSave?: (promptId: PromptId, document: PromptDocumentV1) => void;
}

const PROMPT_EDITOR_OVERLAY_ROUTE_KEY = "prompt-editor";

type PromptEditorDialogResult =
  | { action: "saved" }
  | { action: "local-saved"; promptId: PromptId; document: PromptDocumentV1 };

// ── Helpers ────────────────────────────────────────────────────────────

let blockIdCounter = 0;
function nextBlockId() {
  return `block-${++blockIdCounter}`;
}

function blocksToEditor(blocks: readonly PromptTemplateBlock[]): EditorBlock[] {
  return blocks.map((b) => ({ id: nextBlockId(), when: b.when, text: b.text }));
}

function editorToDocument(blocks: EditorBlock[]) {
  return {
    version: 1 as const,
    blocks: blocks.map((b) => ({ when: b.when, text: b.text })),
  };
}

function blocksAreEqual(a: readonly PromptTemplateBlock[], b: EditorBlock[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((block, i) => {
    const other = b[i]!;
    if (block.text !== other.text) return false;
    if (block.when === null && other.when === null) return true;
    if (block.when === null || other.when === null) return false;
    if (block.when.type !== other.when.type) return false;
    if (block.when.type === "exists" && other.when.type === "exists") {
      return block.when.variable === other.when.variable;
    }
    if (block.when.type === "runtime" && other.when.type === "runtime") {
      return block.when.match === other.when.match;
    }
    return false;
  });
}

const RUNTIME_MATCH_OPTIONS: ReadonlyArray<{
  readonly value: RuntimeMatch;
  readonly label: string;
}> = [
  { value: "devElectron", label: "If Dev Electron" },
  { value: "devWeb", label: "If Dev Web" },
  { value: "prodElectron", label: "If Prod Electron" },
  { value: "prodWeb", label: "If Prod Web" },
  { value: "anyDev", label: "If Any Dev" },
  { value: "anyElectron", label: "If Any Electron" },
];

const ALWAYS_SENTINEL = "__always__";
const RUNTIME_PREFIX = "__runtime:";

function whenToSelectValue(when: PromptTemplateBlock["when"]): string {
  if (when === null) return ALWAYS_SENTINEL;
  if (when.type === "runtime") return `${RUNTIME_PREFIX}${when.match}__`;
  return when.variable;
}

function selectValueToWhen(value: string): PromptTemplateBlock["when"] {
  if (value === ALWAYS_SENTINEL) return null;
  if (value.startsWith(RUNTIME_PREFIX)) {
    const match = value.slice(RUNTIME_PREFIX.length, -2) as RuntimeMatch;
    return { type: "runtime", match };
  }
  return { type: "exists", variable: value as CanonicalPromptVariableKey };
}

function whenToLabel(when: PromptTemplateBlock["when"]): string {
  if (when === null) return "Always";
  if (when.type === "runtime") {
    return RUNTIME_MATCH_OPTIONS.find((o) => o.value === when.match)?.label ?? `If ${when.match}`;
  }
  return `If exists: ${when.variable}`;
}

// ── Sortable Block ─────────────────────────────────────────────────────

function SortableBlock({
  block,
  index,
  supportedVariables,
  supportedConditionTypes,
  blockErrors,
  onUpdate,
  onRemove,
  canRemove,
}: {
  block: EditorBlock;
  index: number;
  supportedVariables: readonly PromptTemplateVariableDefinition[];
  supportedConditionTypes: PromptDefinitionConstraints["supportedConditionTypes"];
  blockErrors: string[];
  onUpdate: (index: number, patch: Partial<Pick<EditorBlock, "when" | "text">>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const conditionValue = whenToSelectValue(block.when);
  const supportsExists = supportedConditionTypes.includes("exists");
  const supportsRuntime = supportedConditionTypes.includes("runtime");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg border bg-background ${
        blockErrors.length > 0
          ? "border-destructive/50"
          : isDragging
            ? "border-primary/40 shadow-md"
            : "border-border"
      }`}
    >
      <div className="flex items-start gap-0">
        <button
          type="button"
          className="mt-2.5 flex h-7 w-7 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>

        <div className="min-w-0 flex-1 space-y-2 py-2.5 pr-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
              Block {index + 1}
            </span>
            <Select
              value={conditionValue}
              onValueChange={(value) => {
                if (value === null) return;
                onUpdate(index, { when: selectValueToWhen(value) });
              }}
            >
              <SelectTrigger
                className="h-6 w-auto min-w-28 gap-1 px-2 text-[11px]"
                aria-label="Block condition"
              >
                <SelectValue>{whenToLabel(block.when)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={ALWAYS_SENTINEL}>
                  Always
                </SelectItem>
                {supportsExists
                  ? supportedVariables.map((v) => (
                      <SelectItem hideIndicator key={v.key} value={v.key}>
                        If exists: {v.key}
                      </SelectItem>
                    ))
                  : null}
                {supportsRuntime
                  ? RUNTIME_MATCH_OPTIONS.map((opt) => (
                      <SelectItem
                        hideIndicator
                        key={opt.value}
                        value={`${RUNTIME_PREFIX}${opt.value}__`}
                      >
                        {opt.label}
                      </SelectItem>
                    ))
                  : null}
              </SelectPopup>
            </Select>
            <div className="flex-1" />
            {canRemove ? (
              <Button
                size="icon-xs"
                variant="ghost"
                className="size-6 text-muted-foreground hover:text-destructive"
                aria-label="Remove block"
                onClick={() => onRemove(index)}
              >
                <Trash2Icon className="size-3" />
              </Button>
            ) : null}
          </div>

          <Textarea
            value={block.text}
            onChange={(e) => onUpdate(index, { text: e.target.value })}
            placeholder="Prompt text..."
            rows={2}
            className="font-mono text-xs"
          />

          {blockErrors.map((error) => (
            <p key={error} className="text-xs text-destructive">
              {error}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Dialog ────────────────────────────────────────────────────────

export function PromptEditorDialog({
  open,
  onClose,
  onSaved,
  documentState,
  scopeInput,
  onLocalSave,
}: PromptEditorDialogProps) {
  const routed = useRoutedOverlaySurface<PromptEditorDialogResult>({
    open,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    routeKey: PROMPT_EDITOR_OVERLAY_ROUTE_KEY,
    params: { documentState, scopeInput, localSave: Boolean(onLocalSave) },
    presentation: { kind: "dialog" },
    enabled: documentState !== null,
    onResult: (result) => {
      if (result.action === "local-saved") {
        onLocalSave?.(result.promptId, result.document);
        onSaved();
        return;
      }
      if (result.action === "saved") onSaved();
    },
  });

  return (
    <Dialog open={routed.domOpen} onOpenChange={routed.onDomOpenChange}>
      <DialogPopup className="max-w-3xl">
        <PromptEditorDialogContent
          documentState={documentState}
          onCancel={onClose}
          onLocalSave={onLocalSave}
          onSaved={onSaved}
          open={routed.domOpen}
          scopeInput={scopeInput}
        />
      </DialogPopup>
    </Dialog>
  );
}

function PromptEditorDialogContent({
  documentState,
  onCancel,
  onLocalSave,
  onSaved,
  open,
  scopeInput,
}: {
  documentState: PromptDocumentState | null;
  onCancel: () => void;
  onSaved: () => void;
  open: boolean;
  scopeInput: PromptManagementScope;
  onLocalSave: ((promptId: PromptId, document: PromptDocumentV1) => void) | undefined;
}) {
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [validation, setValidation] = useState<PromptDocumentValidationResult | null>(null);
  const [preview, setPreview] = useState<PreviewPromptDocumentResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const definition = documentState?.definition ?? null;
  const promptId = definition?.promptId as PromptId | undefined;
  const supportedVariables = definition?.supportedVariables ?? [];
  const supportedConditionTypes = definition?.constraints.supportedConditionTypes ?? [];

  // Initialize blocks when dialog opens or document changes
  useEffect(() => {
    if (documentState && open) {
      setBlocks(blocksToEditor(documentState.effectiveDocument.blocks));
      setValidation(null);
      setPreview(null);
      setPreviewOpen(false);
    }
  }, [documentState, open]);

  const isDirty = useMemo(() => {
    if (!documentState) return false;
    return !blocksAreEqual(documentState.effectiveDocument.blocks, blocks);
  }, [documentState, blocks]);

  const isValid = validation === null || validation.ok;

  // Debounced validation
  useEffect(() => {
    if (!open || !promptId || blocks.length === 0) return;

    if (validateTimerRef.current) {
      clearTimeout(validateTimerRef.current);
    }

    validateTimerRef.current = setTimeout(() => {
      const doc = editorToDocument(blocks);
      void ensureNativeApi()
        .prompts.validateDocument({
          scope: scopeInput.scope,
          ...(scopeInput.scope === "project" ? { projectId: scopeInput.projectId } : {}),
          promptId,
          document: doc,
        })
        .then(setValidation)
        .catch(() => {});
    }, 400);

    return () => {
      if (validateTimerRef.current) {
        clearTimeout(validateTimerRef.current);
      }
    };
  }, [blocks, open, promptId, scopeInput]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setBlocks((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const handleUpdateBlock = useCallback(
    (index: number, patch: Partial<Pick<EditorBlock, "when" | "text">>) => {
      setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
    },
    [],
  );

  const handleRemoveBlock = useCallback((index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddBlock = useCallback(() => {
    setBlocks((prev) => [...prev, { id: nextBlockId(), when: null, text: "" }]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!promptId) return;
    setSaving(true);
    try {
      const doc = editorToDocument(blocks);
      if (onLocalSave) {
        onLocalSave(promptId, doc);
        toastManager.add({ type: "success", title: "Prompt override applied" });
        onSaved();
        return;
      }
      await ensureNativeApi().prompts.updateDocument({
        scope: scopeInput.scope,
        ...(scopeInput.scope === "project" ? { projectId: scopeInput.projectId } : {}),
        ...(scopeInput.scope === "orchestration-run"
          ? { orchestrationRunId: scopeInput.orchestrationRunId }
          : {}),
        promptId,
        document: doc,
      });
      toastManager.add({ type: "success", title: "Prompt saved" });
      onSaved();
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to save prompt",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }, [blocks, promptId, scopeInput, onSaved, onLocalSave]);

  const canRevert =
    documentState?.scopeState === "customized" || documentState?.scopeState === "overridden";

  const revertLabel =
    scopeInput.scope === "orchestration-run"
      ? "Remove run override"
      : documentState?.scopeState === "overridden"
        ? "Revert to global"
        : "Reset to default";

  const handleRevert = useCallback(async () => {
    if (!promptId) return;
    setReverting(true);
    try {
      await ensureNativeApi().prompts.updateDocument({
        scope: scopeInput.scope,
        ...(scopeInput.scope === "project" ? { projectId: scopeInput.projectId } : {}),
        ...(scopeInput.scope === "orchestration-run"
          ? { orchestrationRunId: scopeInput.orchestrationRunId }
          : {}),
        promptId,
        document: null,
      });
      toastManager.add({ type: "success", title: "Prompt reverted" });
      onSaved();
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to revert prompt",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setReverting(false);
    }
  }, [promptId, scopeInput, onSaved]);

  const handleTogglePreview = useCallback(async () => {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(true);
    if (!promptId) return;
    try {
      const doc = editorToDocument(blocks);
      const result = await ensureNativeApi().prompts.previewDocument({
        scope: scopeInput.scope,
        ...(scopeInput.scope === "project" ? { projectId: scopeInput.projectId } : {}),
        promptId,
        document: doc,
      });
      setPreview(result);
    } catch {
      setPreview(null);
    }
  }, [previewOpen, blocks, promptId, scopeInput]);

  // Build per-block error map
  const blockErrorMap = useMemo(() => {
    const map = new Map<number, string[]>();
    if (!validation || validation.ok) return map;
    for (const error of validation.errors) {
      if (error.blockIndex !== null) {
        const existing = map.get(error.blockIndex) ?? [];
        existing.push(error.message);
        map.set(error.blockIndex, existing);
      }
    }
    return map;
  }, [validation]);

  const globalErrors = useMemo(() => {
    if (!validation || validation.ok) return [];
    return validation.errors.filter((e) => e.blockIndex === null).map((e) => e.message);
  }, [validation]);

  const blockIds = useMemo(() => blocks.map((b) => b.id), [blocks]);

  const scopeLabel = scopeInput.scope === "global" ? "Global" : `Project override`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{definition?.label ?? "Edit Prompt"}</DialogTitle>
        <DialogDescription>
          {scopeLabel} &middot; {definition?.description ?? ""}
        </DialogDescription>
      </DialogHeader>

      <DialogPanel>
        <div className="space-y-4">
          {/* Supported variables reference */}
          {supportedVariables.length > 0 ? (
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Available variables
              </span>
              <div className="flex flex-wrap gap-1.5">
                {supportedVariables.map((v) => (
                  <Tooltip key={v.key}>
                    <TooltipTrigger
                      render={
                        <Badge variant="outline" size="sm" className="font-mono">
                          {"${" + v.key + "}"}
                        </Badge>
                      }
                    />
                    <TooltipPopup side="top" className="max-w-64">
                      <div className="space-y-0.5">
                        <p className="font-medium">{v.label}</p>
                        <p className="text-muted-foreground">{v.description}</p>
                      </div>
                    </TooltipPopup>
                  </Tooltip>
                ))}
              </div>
            </div>
          ) : null}

          {/* Block list with DnD */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {blocks.map((block, index) => (
                  <SortableBlock
                    key={block.id}
                    block={block}
                    index={index}
                    supportedVariables={supportedVariables}
                    supportedConditionTypes={supportedConditionTypes}
                    blockErrors={blockErrorMap.get(index) ?? []}
                    onUpdate={handleUpdateBlock}
                    onRemove={handleRemoveBlock}
                    canRemove={blocks.length > 1}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <Button size="xs" variant="outline" onClick={handleAddBlock}>
            <PlusIcon className="size-3" />
            Add block
          </Button>

          {/* Global validation errors */}
          {globalErrors.length > 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {globalErrors.map((error) => (
                <p key={error} className="text-xs text-destructive">
                  {error}
                </p>
              ))}
            </div>
          ) : null}

          {/* Preview section */}
          <Collapsible open={previewOpen} onOpenChange={() => void handleTogglePreview()}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void handleTogglePreview()}
            >
              <ChevronDownIcon
                className={`size-3 transition-transform ${previewOpen ? "rotate-0" : "-rotate-90"}`}
              />
              <span>Preview</span>
            </button>
            <CollapsibleContent>
              {preview ? (
                <div className="mt-2 space-y-2">
                  {preview.previewVariables.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {preview.previewVariables.map((pv) => (
                        <Tooltip key={pv.key}>
                          <TooltipTrigger
                            render={
                              <Badge variant="secondary" size="sm" className="font-mono">
                                {pv.key}
                              </Badge>
                            }
                          />
                          <TooltipPopup side="top" className="max-w-80">
                            <p className="break-all font-mono text-[11px]">{pv.value}</p>
                          </TooltipPopup>
                        </Tooltip>
                      ))}
                    </div>
                  ) : null}
                  <pre className="overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-mono text-xs text-foreground">
                    {preview.previewText}
                  </pre>
                </div>
              ) : previewOpen ? (
                <p className="mt-2 text-xs text-muted-foreground">Loading preview...</p>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogPanel>

      <DialogFooter>
        <div className="flex w-full items-center justify-between">
          <div>
            {canRevert ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleRevert()}
                disabled={reverting}
              >
                {reverting ? "Reverting..." : revertLabel}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!isDirty || !isValid || saving}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </>
  );
}

registerOverlayRoute<{
  documentState?: unknown;
  localSave?: unknown;
  scopeInput?: unknown;
}>(PROMPT_EDITOR_OVERLAY_ROUTE_KEY, function PromptEditorOverlayRoute({ message, controller }) {
  return (
    <OverlayRouteDialog>
      <DialogPopup className="max-w-3xl">
        <PromptEditorDialogContent
          documentState={readPromptDocumentStateParam(message.params.documentState)}
          onCancel={() => controller.cancel("cancel")}
          onLocalSave={
            message.params.localSave === true
              ? (promptId, document) =>
                  controller.submit({ action: "local-saved", promptId, document })
              : undefined
          }
          onSaved={() => controller.submit({ action: "saved" })}
          open
          scopeInput={readPromptManagementScopeParam(message.params.scopeInput)}
        />
      </DialogPopup>
    </OverlayRouteDialog>
  );
});

function readPromptManagementScopeParam(value: unknown): PromptManagementScope {
  if (!value || typeof value !== "object") return { scope: "global" };
  const candidate = value as Partial<PromptManagementScope>;
  if (candidate.scope === "project" && typeof candidate.projectId === "string") {
    return { scope: "project", projectId: candidate.projectId };
  }
  if (candidate.scope === "orchestration-run" && typeof candidate.orchestrationRunId === "string") {
    return { scope: "orchestration-run", orchestrationRunId: candidate.orchestrationRunId };
  }
  return { scope: "global" };
}

function readPromptDocumentStateParam(value: unknown): PromptDocumentState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PromptDocumentState>;
  if (!candidate.definition || typeof candidate.definition !== "object") return null;
  const definition = candidate.definition as { promptId?: unknown };
  if (typeof definition.promptId !== "string") return null;
  if (!candidate.effectiveDocument || typeof candidate.effectiveDocument !== "object") return null;
  if (!candidate.shippedDefaultDocument || typeof candidate.shippedDefaultDocument !== "object") {
    return null;
  }
  if (!candidate.globalDocument || typeof candidate.globalDocument !== "object") return null;
  return candidate as PromptDocumentState;
}
