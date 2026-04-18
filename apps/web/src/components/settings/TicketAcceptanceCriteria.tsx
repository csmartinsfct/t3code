import type { AcceptanceCriterion, TicketId } from "@t3tools/contracts";
import { CheckIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ensureNativeApi } from "../../nativeApi";
import { resolveInlineEditBlurAction } from "../management/KanbanTicketDetail";
import { formatRelativeDate } from "./ticketUtils";

interface TicketAcceptanceCriteriaProps {
  ticketId: TicketId;
  criteria: ReadonlyArray<AcceptanceCriterion>;
  onUpdated: () => void;
  onCriteriaChange: (next: AcceptanceCriterion[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function buildCriteriaAfterEdit(
  criteria: ReadonlyArray<AcceptanceCriterion>,
  index: number,
  newText: string,
): AcceptanceCriterion[] {
  return criteria.map((c, i) => (i === index ? { ...c, text: newText } : { ...c }));
}

export function buildCriteriaAfterDelete(
  criteria: ReadonlyArray<AcceptanceCriterion>,
  index: number,
): AcceptanceCriterion[] {
  return criteria.filter((_, i) => i !== index).map((c) => ({ ...c }));
}

export function buildCriteriaAfterAdd(
  criteria: ReadonlyArray<AcceptanceCriterion>,
  text: string,
): AcceptanceCriterion[] {
  return [...criteria.map((c) => ({ ...c })), { text, status: "pending" as const }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TicketAcceptanceCriteria({
  ticketId,
  criteria,
  onUpdated,
  onCriteriaChange,
}: TicketAcceptanceCriteriaProps) {
  const metCount = criteria.filter((c) => c.status === "met").length;

  const [addingNew, setAddingNew] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const cancelEditRef = useRef(false);

  // Track per-row drafts so each row manages its own text independently.
  const draftsRef = useRef<Map<number, string>>(new Map());

  // --- Status toggle (unchanged — uses dedicated endpoint) ----------------

  const handleToggle = useCallback(
    async (index: number, current: AcceptanceCriterion) => {
      try {
        const api = ensureNativeApi();
        const nextStatus = current.status === "met" ? "pending" : "met";
        await api.ticketing.updateCriterionStatus({
          ticketId,
          index,
          status: nextStatus,
        });
        onUpdated();
      } catch (error) {
        console.error("Failed to update criterion status:", error);
      }
    },
    [ticketId, onUpdated],
  );

  // --- Edit text (always-input pattern, like title field) -----------------

  const handleEditSave = useCallback(
    async (index: number) => {
      const draft = draftsRef.current.get(index);
      draftsRef.current.delete(index);
      if (draft == null) return;
      const trimmed = draft.trim();
      if (!trimmed || trimmed === criteria[index]?.text) return;
      await onCriteriaChange(buildCriteriaAfterEdit(criteria, index, trimmed));
    },
    [criteria, onCriteriaChange],
  );

  // --- Delete -------------------------------------------------------------

  const handleDelete = useCallback(
    async (index: number) => {
      draftsRef.current.delete(index);
      await onCriteriaChange(buildCriteriaAfterDelete(criteria, index));
    },
    [criteria, onCriteriaChange],
  );

  // --- Add ----------------------------------------------------------------

  const startAdding = useCallback(() => {
    setAddDraft("");
    setAddingNew(true);
  }, []);

  const handleAddSave = useCallback(async () => {
    const trimmed = addDraft.trim();
    setAddingNew(false);
    setAddDraft("");
    if (!trimmed) return;
    await onCriteriaChange(buildCriteriaAfterAdd(criteria, trimmed));
  }, [addDraft, criteria, onCriteriaChange]);

  const handleAddCancel = useCallback(() => {
    setAddingNew(false);
    setAddDraft("");
  }, []);

  // --- Render -------------------------------------------------------------

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          Acceptance Criteria
          {criteria.length > 0 && ` (${metCount}/${criteria.length})`}
        </p>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded-sm border border-dashed border-muted-foreground/25 text-muted-foreground/50 transition-colors hover:border-muted-foreground/40 hover:text-muted-foreground/80"
          onClick={startAdding}
          aria-label="Add criterion"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>

      {/* Criteria list */}
      {criteria.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {criteria.map((criterion, index) => (
            <CriterionRow
              key={`${index}-${criterion.text}`}
              criterion={criterion}
              onToggle={() => void handleToggle(index, criterion)}
              onFocus={() => draftsRef.current.set(index, criterion.text)}
              onChangeDraft={(text) => draftsRef.current.set(index, text)}
              onSave={() => void handleEditSave(index)}
              onDelete={() => void handleDelete(index)}
              cancelEditRef={cancelEditRef}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {criteria.length === 0 && !addingNew && (
        <p className="text-xs italic text-muted-foreground/60">No acceptance criteria defined.</p>
      )}

      {/* New criterion input */}
      {addingNew && (
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="size-4 shrink-0 rounded-[.25rem] border border-input" />
          <input
            type="text"
            className="flex-1 bg-transparent font-[inherit]! text-xs text-foreground outline-none placeholder:italic placeholder:text-muted-foreground/60"
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onBlur={() => {
              const action = resolveInlineEditBlurAction({
                cancelRequested: cancelEditRef.current,
                isEditing: true,
              });
              if (action === "cancel") {
                cancelEditRef.current = false;
                handleAddCancel();
              } else if (action === "save") {
                void handleAddSave();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                cancelEditRef.current = true;
                e.currentTarget.blur();
              }
            }}
            autoFocus
            placeholder="Describe the criterion..."
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criterion row — always an <input>, no mode switch
// ---------------------------------------------------------------------------

function CriterionRow({
  criterion,
  onToggle,
  onFocus,
  onChangeDraft,
  onSave,
  onDelete,
  cancelEditRef,
}: {
  criterion: AcceptanceCriterion;
  onToggle: () => void;
  onFocus: () => void;
  onChangeDraft: (text: string) => void;
  onSave: () => void;
  onDelete: () => void;
  cancelEditRef: React.RefObject<boolean>;
}) {
  const [localText, setLocalText] = useState(criterion.text);
  const isEditing = useRef(false);

  // Sync from props when not actively editing.
  if (!isEditing.current && localText !== criterion.text) {
    setLocalText(criterion.text);
  }

  const statusTextClass =
    criterion.status === "met"
      ? "text-muted-foreground line-through decoration-muted-foreground/50"
      : criterion.status === "not_met"
        ? "text-destructive"
        : "text-foreground";

  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5">
      {/* Status checkbox */}
      <button type="button" className="relative top-[0.5px] shrink-0" onClick={onToggle}>
        {criterion.status === "met" ? (
          <div className="flex size-4 items-center justify-center rounded-[.25rem] bg-emerald-500 text-white">
            <CheckIcon className="size-3" strokeWidth={3} />
          </div>
        ) : criterion.status === "not_met" ? (
          <div className="flex size-4 items-center justify-center rounded-[.25rem] bg-destructive text-white">
            <XIcon className="size-3" strokeWidth={3} />
          </div>
        ) : (
          <div className="size-4 rounded-[.25rem] border border-input" />
        )}
      </button>

      {/* Always-editable text input */}
      <div className="min-w-0 flex-1">
        <textarea
          rows={1}
          className={`w-full resize-none cursor-text bg-transparent p-0 [field-sizing:content] font-[inherit]! text-sm leading-snug outline-none ${statusTextClass}`}
          value={localText}
          onFocus={() => {
            isEditing.current = true;
            onFocus();
          }}
          onChange={(e) => {
            setLocalText(e.target.value);
            onChangeDraft(e.target.value);
          }}
          onBlur={() => {
            isEditing.current = false;
            const action = resolveInlineEditBlurAction({
              cancelRequested: cancelEditRef.current,
              isEditing: true,
            });
            if (action === "cancel") {
              cancelEditRef.current = false;
              setLocalText(criterion.text);
            } else if (action === "save") {
              onSave();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              cancelEditRef.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {criterion.reason && (
          <p className="mt-0.5 text-[11px] italic text-muted-foreground">{criterion.reason}</p>
        )}
        {criterion.status === "met" && criterion.verifiedBy && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            Verified by {criterion.verifiedBy}
            {criterion.verifiedAt && ` · ${formatRelativeDate(criterion.verifiedAt)}`}
          </p>
        )}
      </div>

      {/* Delete button (visible on hover) */}
      <button
        type="button"
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity duration-200 hover:text-destructive group-hover:opacity-100"
        onClick={onDelete}
        aria-label="Remove criterion"
      >
        <Trash2Icon className="size-3" />
      </button>
    </div>
  );
}
