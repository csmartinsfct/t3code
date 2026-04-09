import type { OrchestrationRun, TicketSummary } from "@t3tools/contracts";
import type { Thread } from "../types";
import type { OrchestrationSwitcherItem } from "./useOrchestrationSwitcher";

function threadHasStarted(thread: Thread | undefined): boolean {
  if (!thread) return false;
  return (
    thread.messages.length > 0 ||
    thread.activities.length > 0 ||
    thread.latestTurn !== null ||
    thread.session !== null
  );
}

export function buildOrchestrationSwitcherItems(input: {
  run: OrchestrationRun | null;
  parentThreadId: string | null | undefined;
  parentTitle: string;
  isParent: boolean;
  childThreads: ReadonlyArray<Thread>;
  ticketById: ReadonlyMap<string, TicketSummary>;
  activeThreadId: string | null | undefined;
}): OrchestrationSwitcherItem[] {
  const { run, parentThreadId, parentTitle, isParent, childThreads, ticketById, activeThreadId } =
    input;

  if (!run || !parentThreadId) return [];

  const childThreadsById = new Map(childThreads.map((thread) => [thread.id, thread] as const));

  const result: OrchestrationSwitcherItem[] = [
    {
      id: "timeline",
      kind: "timeline",
      label: "Timeline",
      sublabel: parentTitle,
      isActive: isParent,
      isStarted: true,
      threadId: parentThreadId,
    },
  ];

  for (let index = 0; index < run.ticketOrder.length; index += 1) {
    const entry = run.ticketOrder[index]!;
    const ticket = ticketById.get(entry.ticketId);
    const workingThread = childThreadsById.get(entry.workingThreadId);
    const reviewThread =
      entry.reviewThreadId !== undefined ? childThreadsById.get(entry.reviewThreadId) : undefined;
    const workIsStarted =
      threadHasStarted(workingThread) ||
      (index <= run.currentTicketIndex && run.status !== "pending");

    result.push({
      id: entry.workingThreadId,
      kind: "working-thread",
      label: ticket?.identifier ?? `Ticket ${index + 1}`,
      sublabel: workingThread?.title ?? ticket?.title ?? "",
      isActive: activeThreadId === entry.workingThreadId,
      isStarted: workIsStarted,
      threadId: entry.workingThreadId,
    });

    if (!entry.reviewThreadId) {
      continue;
    }

    const reviewIsStarted =
      threadHasStarted(reviewThread) ||
      (run.status === "running" &&
        run.currentPhase === "reviewing" &&
        run.currentTicketIndex === index);

    result.push({
      id: entry.reviewThreadId,
      kind: "review-thread",
      label: `${ticket?.identifier ?? `Ticket ${index + 1}`} Review`,
      sublabel: reviewThread?.title ?? ticket?.title ?? "",
      isActive: activeThreadId === entry.reviewThreadId,
      isStarted: reviewIsStarted,
      threadId: entry.reviewThreadId,
    });
  }

  return result;
}
