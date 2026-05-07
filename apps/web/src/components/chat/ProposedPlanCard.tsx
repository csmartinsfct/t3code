import { memo, useCallback, useEffect, useId, useState } from "react";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../../proposedPlan";
import ChatMarkdown from "../ChatMarkdown";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { readNativeApi } from "~/nativeApi";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";

const PROPOSED_PLAN_SAVE_DIALOG_ROUTE_KEY = "proposed-plan-save-dialog";

type ProposedPlanSaveDialogResult = {
  action: "saved";
  relativePath: string;
};

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  status = "ready",
  cwd,
  workspaceRoot,
  onOpenTicketLink,
}: {
  planMarkdown: string;
  status?: "ready" | "rejected" | "cancelled" | undefined;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
  onOpenTicketLink?: (identifier: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [savePath, setSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not copy plan",
        description: error instanceof Error ? error.message : "An error occurred while copying.",
      });
    },
  });
  const savePathInputId = useId();
  const title = proposedPlanTitle(planMarkdown) ?? "Proposed plan";
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown);
  const collapsedPreview = canCollapse
    ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 })
    : null;
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);
  const statusLabel =
    status === "rejected" ? "Plan rejected" : status === "cancelled" ? "Plan cancelled" : "Plan";

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!workspaceRoot) {
      toastManager.add({
        type: "error",
        title: "Workspace path is unavailable",
        description: "This thread does not have a workspace path to save into.",
      });
      return;
    }
    setSavePath((existing) => (existing.length > 0 ? existing : downloadFilename));
    setIsSaveDialogOpen(true);
  };

  const routedSaveDialog = useRoutedOverlaySurface<ProposedPlanSaveDialogResult>({
    open: isSaveDialogOpen,
    onOpenChange: (open) => {
      if (!isSavingToWorkspace) {
        setIsSaveDialogOpen(open);
      }
    },
    enabled: Boolean(workspaceRoot),
    routeKey: PROPOSED_PLAN_SAVE_DIALOG_ROUTE_KEY,
    params: {
      workspaceRoot: workspaceRoot ?? "",
      initialSavePath: savePath,
      downloadFilename,
      saveContents,
    },
    presentation: { kind: "dialog" },
    onResult: (result) => {
      setIsSaveDialogOpen(false);
      setSavePath(result.relativePath);
      toastManager.add({
        type: "success",
        title: "Plan saved to workspace",
        description: result.relativePath,
      });
    },
    onError: (message) => {
      toastManager.add({
        type: "error",
        title: "Could not save plan",
        description: message,
      });
    },
  });

  const handleDomSaveToWorkspace = () => {
    const api = readNativeApi();
    const relativePath = savePath.trim();
    if (!api || !workspaceRoot) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: "Enter a workspace path",
      });
      return;
    }

    setIsSavingToWorkspace(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath,
        contents: saveContents,
      })
      .then((result) => {
        setIsSaveDialogOpen(false);
        toastManager.add({
          type: "success",
          title: "Plan saved to workspace",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not save plan",
          description: error instanceof Error ? error.message : "An error occurred while saving.",
        });
      })
      .then(
        () => {
          setIsSavingToWorkspace(false);
        },
        () => {
          setIsSavingToWorkspace(false);
        },
      );
  };

  return (
    <div className="rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={status === "ready" ? "secondary" : "outline"}>{statusLabel}</Badge>
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
        </div>
        <Menu
          overlayItems={[
            { id: "copy", label: isCopied ? "Copied!" : "Copy to clipboard" },
            { id: "download", label: "Download as markdown" },
            {
              id: "save",
              label: "Save to workspace",
              disabled: !workspaceRoot || isSavingToWorkspace,
            },
          ]}
          overlayMenuAlign="end"
          overlayOnSelect={(id) => {
            if (id === "copy") {
              handleCopyPlan();
              return;
            }
            if (id === "download") {
              handleDownload();
              return;
            }
            if (id === "save" && workspaceRoot && !isSavingToWorkspace) {
              openSaveDialog();
            }
          }}
        >
          <MenuTrigger
            render={<Button aria-label="Plan actions" size="icon-xs" variant="outline" />}
          >
            <EllipsisIcon aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={handleCopyPlan}>
              {isCopied ? "Copied!" : "Copy to clipboard"}
            </MenuItem>
            <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
            <MenuItem onClick={openSaveDialog} disabled={!workspaceRoot || isSavingToWorkspace}>
              Save to workspace
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="mt-4">
        <div className={cn("relative", canCollapse && !expanded && "max-h-104 overflow-hidden")}>
          {canCollapse && !expanded ? (
            <ChatMarkdown
              text={collapsedPreview ?? ""}
              cwd={cwd}
              isStreaming={false}
              {...(onOpenTicketLink ? { onOpenTicketLink } : {})}
            />
          ) : (
            <ChatMarkdown
              text={displayedPlanMarkdown}
              cwd={cwd}
              isStreaming={false}
              {...(onOpenTicketLink ? { onOpenTicketLink } : {})}
            />
          )}
          {canCollapse && !expanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card/95 via-card/80 to-transparent" />
          ) : null}
        </div>
        {canCollapse ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse plan" : "Expand plan"}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={routedSaveDialog.domOpen} onOpenChange={routedSaveDialog.onDomOpenChange}>
        <DialogPopup className="max-w-xl">
          <ProposedPlanSaveDialogContent
            dialogId={savePathInputId}
            downloadFilename={downloadFilename}
            isSaving={isSavingToWorkspace}
            onCancel={() => setIsSaveDialogOpen(false)}
            onSave={() => void handleDomSaveToWorkspace()}
            savePath={savePath}
            setSavePath={setSavePath}
            workspaceRoot={workspaceRoot}
          />
        </DialogPopup>
      </Dialog>
    </div>
  );
});

function ProposedPlanSaveDialogContent({
  dialogId,
  downloadFilename,
  isSaving,
  onCancel,
  onSave,
  savePath,
  setSavePath,
  workspaceRoot,
}: {
  dialogId: string;
  downloadFilename: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
  savePath: string;
  setSavePath: (value: string) => void;
  workspaceRoot: string | undefined;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Save plan to workspace</DialogTitle>
        <DialogDescription>
          Enter a path relative to <code>{workspaceRoot ?? "the workspace"}</code>.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-3">
        <label htmlFor={dialogId} className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Workspace path</span>
          <Input
            id={dialogId}
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder={downloadFilename}
            spellCheck={false}
            disabled={isSaving}
          />
        </label>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ProposedPlanSaveOverlayRouteContent({
  controller,
  downloadFilename,
  initialSavePath,
  saveContents,
  workspaceRoot,
}: {
  controller: {
    cancel: (reason?: string) => void;
    fail: (error: Error) => void;
    submit: (value: ProposedPlanSaveDialogResult) => void;
  };
  downloadFilename: string;
  initialSavePath: string;
  saveContents: string;
  workspaceRoot: string;
}) {
  const dialogId = useId();
  const [savePath, setSavePath] = useState(initialSavePath);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSavePath(initialSavePath);
  }, [initialSavePath]);

  const handleSave = useCallback(() => {
    const api = readNativeApi();
    const relativePath = savePath.trim();
    if (!api || !workspaceRoot) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: "Enter a workspace path",
      });
      return;
    }

    setIsSaving(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath,
        contents: saveContents,
      })
      .then((result) => {
        controller.submit({ action: "saved", relativePath: result.relativePath });
      })
      .catch((error) => {
        controller.fail(
          error instanceof Error ? error : new Error("An error occurred while saving."),
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [controller, saveContents, savePath, workspaceRoot]);

  return (
    <ProposedPlanSaveDialogContent
      dialogId={dialogId}
      downloadFilename={downloadFilename}
      isSaving={isSaving}
      onCancel={() => controller.cancel("cancel")}
      onSave={handleSave}
      savePath={savePath}
      setSavePath={setSavePath}
      workspaceRoot={workspaceRoot}
    />
  );
}

registerOverlayRoute<{
  downloadFilename?: unknown;
  initialSavePath?: unknown;
  saveContents?: unknown;
  workspaceRoot?: unknown;
}>(
  PROPOSED_PLAN_SAVE_DIALOG_ROUTE_KEY,
  function ProposedPlanSaveOverlayRoute({ message, controller }) {
    const workspaceRoot = readStringParam(message.params.workspaceRoot);
    const downloadFilename = readStringParam(message.params.downloadFilename);
    const initialSavePath = readStringParam(message.params.initialSavePath) || downloadFilename;
    const saveContents = readStringParam(message.params.saveContents);

    if (!workspaceRoot || !downloadFilename) {
      controller.fail(new Error("Save-plan overlay requires a workspace path and filename."));
      return null;
    }

    return (
      <OverlayRouteDialog>
        <DialogPopup className="max-w-xl">
          <ProposedPlanSaveOverlayRouteContent
            controller={controller}
            downloadFilename={downloadFilename}
            initialSavePath={initialSavePath}
            saveContents={saveContents}
            workspaceRoot={workspaceRoot}
          />
        </DialogPopup>
      </OverlayRouteDialog>
    );
  },
);

function readStringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
