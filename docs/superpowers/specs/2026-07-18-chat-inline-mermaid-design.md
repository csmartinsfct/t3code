# Inline Mermaid Diagrams in Chat

**Date:** 2026-07-18
**Status:** Approved design

## Problem

Mermaid code fences in chat messages currently render as raw source through
the Shiki text highlighter (`ChatMarkdown.tsx` `pre()` handler). Users see the
diagram source, not the diagram. Tickets already render mermaid artifacts as
interactive diagrams via `TicketMermaidArtifactView`, with pan/zoom and an
expanded view. Chat should render mermaid fences as diagrams inline and let the
user click to expand into a zoom/pan view, mirroring the ticket experience.

## Goals

- Render ` ```mermaid ` fences in chat messages as SVG diagrams inline.
- Clicking the inline diagram opens a full-screen modal overlay with
  pan/zoom/reset controls (read-only).
- Remain robust during streaming and on invalid source (fall back to raw code).
- Remove duplication between chat and ticket mermaid rendering by extracting
  shared logic (per the repo's "duplicate logic is a code smell" rule).

## Non-Goals (YAGNI)

- Editing a diagram from a chat message.
- Saving a chat diagram as a ticket artifact.
- Live mid-stream rendering of partial diagrams.
- An inline "view source" toggle or persistent copy button on the rendered
  diagram (the raw-code fallback still has copy via the existing code block).

## Approach

Extract the render + zoom/pan logic that currently lives inline in
`TicketMermaidArtifactView.tsx` into a shared `mermaid/` module, then consume it
from both the ticket viewer and a new chat component.

### New shared module: `apps/web/src/components/mermaid/`

**`useMermaidSvg(source, { enabled }): { svg: string; error: string | null }`**

- Wraps the render loop currently in the ticket viewer's `useEffect`:
  `mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, sequence: { useMaxWidth: false }, flowchart: { useMaxWidth: false } })`
  then iterates `getMermaidRenderSources(source)` and calls `mermaid.render`.
- Theme-aware (reads `document.documentElement.classList.contains("dark")`,
  matching current behavior).
- `enabled: false` short-circuits and returns empty svg / no error — used while a
  chat message is still streaming.
- Uses a stable render-id counter and cancels in-flight renders on unmount /
  source change (preserve the existing `cancelled` guard).

**`MermaidZoomPanViewer({ svg, error }: ...)`**

- The interactive viewport extracted from `TicketMermaidArtifactView`: pan
  (pointer drag), zoom (wheel + buttons), fit-to-viewport, reset, and the
  zoom-% badge.
- Read-only — no source textarea, no save.
- Reuses `TicketMermaidArtifactView.logic.ts` (`clampMermaidZoom`,
  `zoomMermaidTransformAtPoint`, `MermaidViewTransform`). The logic file moves
  into `components/mermaid/` and its test moves with it; update imports in the
  ticket viewer.

### New chat component: `apps/web/src/components/chat/ChatMermaidBlock.tsx`

Props: `{ code: string; isStreaming: boolean; fallback: ReactNode }` (fallback is
the existing raw code-block JSX so the streaming/error path is identical to
today).

Rendering decision uses a pure helper:

```ts
export function shouldRenderMermaidDiagram(isStreaming: boolean, hasError: boolean): boolean {
  return !isStreaming && !hasError;
}
```

- `enabled = !isStreaming` is passed to `useMermaidSvg`.
- If `shouldRenderMermaidDiagram(isStreaming, Boolean(error))` is false → render
  `fallback` (raw code block).
- Otherwise → render the inline SVG (direct injection with `max-width: 100%`,
  natural height, non-interactive) inside a `<button>` that opens the modal.
- Modal: existing `Dialog` / `DialogPopup` (from `components/ui/dialog.tsx`),
  sized large, hosting `MermaidZoomPanViewer`. Closes on Esc / backdrop click
  (default `Dialog` behavior). The same `svg`/`error` from `useMermaidSvg` is
  reused for both inline and modal to avoid a second render.

### Wiring: `apps/web/src/components/ChatMarkdown.tsx`

In the `pre()` handler, add a branch **before** the default Shiki path:

```ts
if (isMermaidBlock(codeBlock.className)) {
  return (
    <ChatMermaidBlock
      code={codeBlock.code}
      isStreaming={isStreaming}
      fallback={<pre {...props}>{children}</pre>}
    />
  );
}
```

`isMermaidBlock(className)` checks the fence language resolves to `mermaid`
(reuse the existing `CODE_FENCE_LANGUAGE_REGEX` / `extractFenceLanguage`
convention).

### Refactor: `TicketMermaidArtifactView.tsx`

- Replace the inline render `useEffect` with `useMermaidSvg`.
- Replace the viewport JSX + pan/zoom handlers with `MermaidZoomPanViewer`.
- Keep the header, edit toggle, source textarea, and save-to-artifact logic —
  those are ticket-specific and out of scope for chat.

## Data Flow

```
fence text
  -> ChatMarkdown pre() detects language-mermaid
  -> ChatMermaidBlock(code, isStreaming)
       - streaming or render error -> raw code block (fallback)
       - done + valid -> useMermaidSvg -> inline SVG (fit width, non-interactive)
            -> click -> Dialog -> MermaidZoomPanViewer(svg) [pan/zoom/reset]
```

## Error Handling

- Partial or invalid mermaid source → `useMermaidSvg` returns `error`;
  `ChatMermaidBlock` renders the raw code block. No error banner in chat.
- Render exceptions are caught inside `useMermaidSvg` (preserve the existing
  try/catch + `getMermaidRenderSources` semicolon fallback for sequence diagrams).
- `securityLevel: "strict"` is retained.

## Testing

- **Move & keep:** `TicketMermaidArtifactView.logic.test.ts` moves to
  `components/mermaid/` alongside the logic file; assertions unchanged.
- **Add unit tests:**
  - `isMermaidBlock(className)` — matches `language-mermaid`, rejects others.
  - `shouldRenderMermaidDiagram(isStreaming, hasError)` — truth table.
- **Manual (dev browser):**
  - Inline diagram appears only after streaming completes.
  - Click opens the modal; pan, zoom (wheel + buttons), and reset work; zoom-%
    badge updates.
  - Esc and backdrop click close the modal.
  - Invalid mermaid source falls back to the raw code block.
  - Ticket mermaid viewer still renders, pans/zooms, edits, and saves after the
    refactor (regression check).

## Task Completion

`bun fmt`, `bun lint`, and `bun typecheck` must pass. Tests run via
`bun run test` (never `bun test`).
