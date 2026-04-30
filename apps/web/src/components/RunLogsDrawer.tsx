import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { XIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useManagedRunLogs } from "~/hooks/useManagedRunLogs";
import { cn } from "~/lib/utils";
import {
  selectRunLogsDrawerOpen,
  useRunLogsDrawerStore,
  type RunLogsTab,
} from "~/runLogsDrawerStore";

import {
  TERMINAL_FONT_FAMILY,
  clampBottomDrawerHeight,
  xtermThemeFromApp,
} from "./terminal/xtermShared";

export interface RunServiceDescriptor {
  readonly serviceId: string;
  readonly label: string;
  readonly validationStatus: "unknown" | "healthy" | "unhealthy";
}

interface RunLogsViewportProps {
  readonly runId: string;
  readonly serviceId: string | null;
  readonly active: boolean;
  readonly resizeEpoch: number;
  readonly drawerHeight: number;
  readonly resolveService: (serviceId: string) => { label: string; paletteIndex: number };
}

function RunLogsViewport({
  runId,
  serviceId,
  active,
  resizeEpoch,
  drawerHeight,
  resolveService,
}: RunLogsViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    const fitAddon = new FitAddon();
    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      lineHeight: 1.2,
      fontSize: 12,
      scrollback: 5_000,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: xtermThemeFromApp(),
    });
    term.loadAddon(fitAddon);
    term.open(mount);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    setTerminal(term);

    const themeObserver = new MutationObserver(() => {
      const t = terminalRef.current;
      if (!t) return;
      t.options.theme = xtermThemeFromApp();
      t.refresh(0, t.rows - 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      themeObserver.disconnect();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminal(null);
      term.dispose();
    };
  }, []);

  // Keep the viewport sized to the drawer.
  useEffect(() => {
    const fitAddon = fitAddonRef.current;
    const term = terminalRef.current;
    if (!fitAddon || !term) return;
    const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
    const frame = window.requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // The container may have zero size briefly during transitions.
      }
      if (wasAtBottom) {
        term.scrollToBottom();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawerHeight, resizeEpoch, active]);

  useManagedRunLogs({ runId, serviceId, terminal, enabled: true, resolveService });

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-[4px]",
        active ? "block" : "hidden",
      )}
    />
  );
}

interface RunLogsTabStripProps {
  readonly tabs: ReadonlyArray<{ runId: string; label: string; running: boolean }>;
  readonly activeRunId: string | null;
  readonly onSelect: (runId: string) => void;
  readonly onClose: (runId: string) => void;
}

function RunLogsTabStrip({ tabs, activeRunId, onSelect, onClose }: RunLogsTabStripProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 px-2 py-1">
      {tabs.map((tab) => {
        const isActive = tab.runId === activeRunId;
        return (
          <div
            key={tab.runId}
            className={cn(
              "group/run-logs-tab flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
              isActive
                ? "border-border bg-accent text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5"
              onClick={() => onSelect(tab.runId)}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  tab.running ? "bg-emerald-500" : "bg-muted-foreground/60",
                )}
              />
              <span className="max-w-[160px] truncate">{tab.label}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.label} logs`}
              className={cn(
                "inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground transition-opacity",
                isActive
                  ? "opacity-100 hover:bg-background/60 hover:text-foreground"
                  : "opacity-0 group-hover/run-logs-tab:opacity-100 hover:bg-background/60 hover:text-foreground",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.runId);
              }}
            >
              <XIcon className="size-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface RunLogsServiceStripProps {
  readonly services: ReadonlyArray<RunServiceDescriptor>;
  readonly activeServiceId: string | null;
  readonly onSelect: (serviceId: string | null) => void;
}

function RunLogsServiceStrip({ services, activeServiceId, onSelect }: RunLogsServiceStripProps) {
  const renderTab = (
    key: string,
    label: string,
    selected: boolean,
    dotClass: string | null,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
        selected
          ? "border-border bg-accent/70 text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      {dotClass !== null && (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
      )}
      <span className="max-w-[180px] truncate">{label}</span>
    </button>
  );

  const dotForStatus = (status: RunServiceDescriptor["validationStatus"]): string => {
    if (status === "healthy") return "bg-emerald-500";
    if (status === "unhealthy") return "bg-destructive";
    return "bg-muted-foreground/60";
  };

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 px-2 py-0.5">
      {renderTab("__all__", "All", activeServiceId === null, null, () => onSelect(null))}
      {services.map((service) =>
        renderTab(
          service.serviceId,
          service.label,
          activeServiceId === service.serviceId,
          dotForStatus(service.validationStatus),
          () => onSelect(service.serviceId),
        ),
      )}
    </div>
  );
}

interface RunLogsTabContentsProps {
  readonly tab: RunLogsTab;
  readonly visible: boolean;
  readonly drawerHeight: number;
  readonly resizeEpoch: number;
  readonly services: ReadonlyArray<RunServiceDescriptor>;
}

function RunLogsTabContents({
  tab,
  visible,
  drawerHeight,
  resizeEpoch,
  services,
}: RunLogsTabContentsProps) {
  const setActiveService = useRunLogsDrawerStore((state) => state.setActiveService);
  const showSubStrip = services.length >= 2;
  // Build a stable resolver for serviceId → display label + palette index.
  const resolveService = useMemo(() => {
    const lookup = new Map(
      services.map((service, index) => [
        service.serviceId,
        { label: service.label, paletteIndex: index },
      ]),
    );
    return (serviceId: string) => lookup.get(serviceId) ?? { label: serviceId, paletteIndex: 0 };
  }, [services]);

  const activeServiceId = showSubStrip ? tab.activeServiceId : null;

  // For runs with a single declared service we render that service's stream
  // directly (no `[name]` prefix). The merged "All" viewport is only worth
  // mounting when there's more than one service to interleave.
  const singleServiceId = !showSubStrip && services.length === 1 ? services[0]!.serviceId : null;

  return (
    <div className={cn("h-full min-h-0 flex-col", visible ? "flex" : "hidden")}>
      {showSubStrip && (
        <RunLogsServiceStrip
          services={services}
          activeServiceId={activeServiceId}
          onSelect={(serviceId) => setActiveService(tab.runId, serviceId)}
        />
      )}
      <div className="min-h-0 w-full flex-1 p-1">
        {/* Merged "All" viewport — only mounted when there are multiple services. */}
        {showSubStrip && (
          <RunLogsViewport
            key={`${tab.runId}::all`}
            runId={tab.runId}
            serviceId={null}
            active={visible && activeServiceId === null}
            resizeEpoch={resizeEpoch}
            drawerHeight={drawerHeight}
            resolveService={resolveService}
          />
        )}
        {showSubStrip &&
          services.map((service) => (
            <RunLogsViewport
              key={`${tab.runId}::${service.serviceId}`}
              runId={tab.runId}
              serviceId={service.serviceId}
              active={visible && activeServiceId === service.serviceId}
              resizeEpoch={resizeEpoch}
              drawerHeight={drawerHeight}
              resolveService={resolveService}
            />
          ))}
        {!showSubStrip && (
          <RunLogsViewport
            key={`${tab.runId}::single`}
            runId={tab.runId}
            // Single-service composite → bind to that service's stream directly.
            // Legacy / no declared services → null so we read the merged stream
            // (which equals the single legacy stream).
            serviceId={singleServiceId}
            active={visible}
            resizeEpoch={resizeEpoch}
            drawerHeight={drawerHeight}
            resolveService={resolveService}
          />
        )}
      </div>
    </div>
  );
}

interface RunLogsDrawerProps {
  readonly resolveTabLabel: (runId: string) => string;
  readonly resolveRunRunning: (runId: string) => boolean;
  readonly resolveRunServices: (runId: string) => ReadonlyArray<RunServiceDescriptor>;
}

export default function RunLogsDrawer({
  resolveTabLabel,
  resolveRunRunning,
  resolveRunServices,
}: RunLogsDrawerProps) {
  const tabs = useRunLogsDrawerStore((state) => state.tabs);
  const activeRunId = useRunLogsDrawerStore((state) => state.activeRunId);
  const height = useRunLogsDrawerStore((state) => state.height);
  const open = useRunLogsDrawerStore(selectRunLogsDrawerOpen);
  const setHeightStore = useRunLogsDrawerStore((state) => state.setHeight);
  const closeTab = useRunLogsDrawerStore((state) => state.closeTab);
  const setActive = useRunLogsDrawerStore((state) => state.setActive);

  const [drawerHeight, setDrawerHeight] = useState(() => clampBottomDrawerHeight(height, height));
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const drawerHeightRef = useRef(drawerHeight);
  const resizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);

  useEffect(() => {
    drawerHeightRef.current = drawerHeight;
  }, [drawerHeight]);

  useEffect(() => {
    const clamped = clampBottomDrawerHeight(height, height);
    setDrawerHeight(clamped);
    drawerHeightRef.current = clamped;
  }, [height]);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    didResizeDuringDragRef.current = false;
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: drawerHeightRef.current,
    };
  }, []);

  const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = clampBottomDrawerHeight(
      state.startHeight + (state.startY - event.clientY),
      state.startHeight,
    );
    if (next === drawerHeightRef.current) return;
    didResizeDuringDragRef.current = true;
    drawerHeightRef.current = next;
    setDrawerHeight(next);
  }, []);

  const handleResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      resizeStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!didResizeDuringDragRef.current) return;
      setHeightStore(drawerHeightRef.current);
      setResizeEpoch((value) => value + 1);
    },
    [setHeightStore],
  );

  useEffect(() => {
    if (!open) return;
    const onWindowResize = () => {
      const clamped = clampBottomDrawerHeight(drawerHeightRef.current, drawerHeightRef.current);
      if (clamped !== drawerHeightRef.current) {
        drawerHeightRef.current = clamped;
        setDrawerHeight(clamped);
        setHeightStore(clamped);
      }
      setResizeEpoch((value) => value + 1);
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [open, setHeightStore]);

  const tabStripData = useMemo(
    () =>
      tabs.map((tab) => {
        // Resolver returns the live script name from `activeManagedRuns`. After
        // a run stops or its script is deleted that lookup fails; fall back to
        // the label captured at openTab time so the tab keeps a real name.
        const liveLabel = resolveTabLabel(tab.runId);
        const looksLikeFallback = liveLabel === tab.runId.slice(0, 12) || liveLabel === tab.runId;
        return {
          runId: tab.runId,
          label: looksLikeFallback ? tab.label : liveLabel,
          running: resolveRunRunning(tab.runId),
        };
      }),
    [tabs, resolveTabLabel, resolveRunRunning],
  );

  if (!open) {
    return null;
  }

  return (
    <aside
      className="run-logs-drawer relative flex min-w-0 shrink-0 flex-col overflow-hidden border-t border-border/80 bg-background"
      style={{ height: `${drawerHeight}px` }}
      aria-label="Run logs"
    >
      <div
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize bg-border/0 transition-colors hover:bg-border/40"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
      />

      <RunLogsTabStrip
        tabs={tabStripData}
        activeRunId={activeRunId}
        onSelect={setActive}
        onClose={closeTab}
      />

      <div className="min-h-0 w-full flex-1">
        {tabs.map((tab) => (
          <RunLogsTabContents
            key={tab.runId}
            tab={tab}
            visible={tab.runId === activeRunId}
            resizeEpoch={resizeEpoch}
            drawerHeight={drawerHeight}
            services={resolveRunServices(tab.runId)}
          />
        ))}
      </div>
    </aside>
  );
}
