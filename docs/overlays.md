# Overlay Surfaces

T3 Code has two ways to render popups, menus, dialogs, sheets, command palettes, and rich popovers:

- **DOM overlays** render in the host React tree with the normal Base UI portal/content path.
- **Native overlays** render in a transparent Electron `WebContentsView` above the embedded browser.

The UI contract is that both paths look and behave the same. A user should not be able to tell which runtime path was used, except that native overlays keep the embedded Chromium browser visible instead of hiding it.

## Doc Ownership

This document owns overlay UI/runtime policy: when to use DOM vs native overlays, primitive vs routed overlays, and which routed wrapper semantics (`Menu`, `Popover`, `Dialog`, `Sheet`, etc.) a component should choose. When changing overlay selection, dismissal behavior, or browser-visible fallback behavior, update this document first.

Implementation details for Electron compositor ordering, overlay pool IPC, and browser host plumbing live in [Browser Tools](browser-tools.md#overlay-view-system). Feature-specific behavior, such as the Runs control, should also be summarized in that feature's doc after the policy is updated here.

## When Native Overlays Are Used

Native overlays are active only when all of these are true:

- the app is running in Electron,
- the embedded browser is mounted,
- the current app surface leaves that browser visually relevant.

Full-page surfaces such as `/settings` may leave a browser `WebContentsView` mounted behind the app shell, but the browser is not visually relevant there. Those routes use normal DOM overlays and should not acquire a native overlay or call the old browser-suspension path.

If native overlay acquisition fails, the component must fall back to its existing DOM behavior.

## Dual Runtime Rule

Overlay-capable components must keep both paths first-class:

| State                                      | Rendering path                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded browser visible                   | Native overlay path. The host adapter opens an overlay `WebContentsView`; Chromium stays visible underneath.                              |
| No embedded browser visible                | DOM path. The component renders through its normal Base UI popup/dialog/sheet in the host React tree.                                     |
| Full-page app surface covers the browser   | DOM path. The browser may exist behind the page, but the user cannot see or interact with it.                                             |
| Native overlay unavailable/acquire failure | DOM fallback. Preserve the pre-overlay behavior, including browser suspension where that still applies for browser-adjacent DOM overlays. |

Do not remove the DOM popup/content from a callsite just because it has a native overlay path. The DOM path is still required for web builds, hidden-browser layouts, full-page surfaces, popout/failure cases, and tests.

## Choosing A Path

Use the **primitive overlay** path when the popup can be represented as JSON plus discrete host callbacks:

- command menus,
- checked/radio menus,
- grouped menus,
- select lists,
- branch/model pickers,
- serialized autocomplete/typeahead rows,
- menu-local actions whose loading/disabled state can be refreshed by re-rendering the same overlay session.

Use the **routed overlay** path when exact UI parity requires arbitrary React content:

- `Dialog`,
- `AlertDialog`,
- `Sheet`,
- `CommandDialog`,
- arbitrary-child `Popover`,
- rich cards/menus with custom layouts,
- forms with controlled inputs and validation,
- TanStack Query/Zustand/WebSocket-backed state,
- any component tree that would otherwise have to be reimplemented inside a generic menu item renderer.

Keep the DOM fallback for every routed surface. The native route should share the same content component as the DOM route whenever possible.

When a routed overlay is visually menu-like but contains arbitrary interactive content, choose the route wrapper by interaction semantics, not by appearance:

- use `OverlayRouteMenu` / `OverlayRouteMenuPopup` for command-menu behavior where moving through rows, outside-click dismissal, and menu focus semantics are desired;
- use `OverlayRoutePopover` / `OverlayRoutePopoverPopup` for rich cards, nested hover panels, embedded buttons, or controls that users must move into without closing the parent surface.

For example, `ManagedRunsControl` keeps a normal `Menu` as its DOM fallback, but its browser-visible native route uses `OverlayRoutePopover` because service URL hover controls sit inside the active Runs surface and must remain interactive.

## Primitive Overlays

Primitive overlays are serialized through `OverlayRenderMessage` and rendered by the overlay app:

- `Menu` supports `overlayItems`, `overlayOnSelect(id)`, and `overlayOnAction(id)`.
- `Select` supports serialized rows, separators, icons, and `hideIndicator`.
- `Combobox` owns the overlay search input and emits `search` events so the host can refresh JSON rows.
- `Autocomplete` supports plain serialized result rows.
- The chat composer `@`, `/`, and `/model` menu uses a narrow `composer-command` overlay so it can render the exact composer command menu rather than pretending to be a generic autocomplete.

Primitive payloads must be JSON-serializable. Callbacks become event IDs; the overlay emits an event and the host maps it back to the real callback.

The native primitive path should mirror the DOM path by reusing the same primitives, class strings, row components, or shared body components. Do not invent a visually similar but separate component.

Primitive adapters that attempt native acquisition must preserve their DOM fallback state. If acquisition fails or is suppressed after a trigger click, uncontrolled primitives must update their internal open state before calling the external `onOpenChange(true)` callback, and controlled primitives must give their owner the same open-change callback. Otherwise host menus that pass `overlayItems` can render neither the native overlay nor the DOM popup.

## Routed Overlays

Routed overlays use one generic `route` message. The overlay view runs the second Vite entry, registers route components via `overlayRouteRegistry.tsx`, and renders the matching route with:

- `message.params` and `message.context`,
- TanStack Query and app atom providers from `OverlayRouteProviders`,
- a WebSocket-backed `window.nativeApi`,
- a controller with `submit(value)`, `cancel(reason)`, and `fail(error)`.

Host callsites should use `useRoutedOverlaySurface()` from `apps/web/src/routedOverlayAdapters.tsx`. The host keeps the existing DOM component mounted behind `routed.domOpen`, and the native route renders the same content tree when native overlays are active.

Routes can emit non-dismissing events for controls that update host state while the popup remains open. The host then re-renders the same overlay session with refreshed params.

Action menus that require exact parity, including the Git actions menu, project-script actions menu, plan action menus, and orchestration resume menu, use routed menu overlays rather than serialized `overlayItems`. Their DOM path and native route share a single content component; the route should only adapt transport concerns such as result submission, anchor positioning, and overlay dismissal.

## Positioning

The overlay view cannot query the host DOM. The host passes a trigger/input element to `trackNativeOverlayAnchor()`, which samples `getBoundingClientRect()` while the overlay is open and re-renders when the rounded rect changes.

`OverlayShell` keys anchored overlay content by the rounded anchor rect so Base UI `Positioner` remounts and recomputes placement during live resize. This keeps native popups following their trigger as closely as Electron/Chromium repaint and IPC cadence allows.

Do not pass a one-time rect unless the surface is intentionally fixed to its original position.

## Interaction Rules

- Base UI close requests must forward back to the native overlay bridge.
- Outside click and Escape should dismiss the full-window overlay so it cannot become an invisible glass pane over the app.
- Header/row action buttons should emit non-dismissing `action` events by default. Use `dismissOnAction` only when the action intentionally opens another surface or ends the interaction.
- The host `WebContents` must be focused again after release so app shortcuts work immediately.
- Electron clipboard actions should prefer `desktopBridge.clipboard.writeText()` because focus may still be transitioning back from the overlay `WebContents`.
- Controlled primitives must not switch between controlled and uncontrolled `open` state when toggling between DOM and native paths.
- Shared routed JSX can still receive different initial focus/highlight state because the native route mounts in a separate overlay React root. Visual hover affordances, such as row backgrounds or secondary action buttons, should use actual hover/pointer state unless keyboard focus is intentionally meant to look the same as hover.

## Explicit Exceptions

Responsive chat-layout sheets such as `DiffPanelSheet` and `FileExplorerSheet` remain DOM sheets because they are mobile/narrow-layout panels, not browser-adjacent desktop popups in the current split layout.

`OrchestrateConfirmDialog` also remains DOM-only for now because the current management/ticket layout is mutually exclusive with the embedded browser. Revisit these exceptions if those surfaces become browser-adjacent.

## Known Platform Artifact

The native overlay view uses a transparent background (`#00000000`). On macOS, transparent child `WebContentsView` compositing can subtly shift the brightness of content behind the overlay while it is open. The overlay entry disables the global app texture layer so it does not add a second full-window noise overlay, but the remaining compositor-level shift is platform behavior. Avoid adding any full-window background, opacity, backdrop, blur, or texture to the overlay document unless the visible UI explicitly needs it.

## Implementation References

- Browser/compositor mechanics: [Browser Tools](browser-tools.md#overlay-view-system)
- Visual tokens and component styling: [Design Language](design-language.md)
- Host bridge: `apps/web/src/nativeOverlayBridge.ts`
- Overlay entry: `apps/web/overlay.html`, `apps/web/src/overlay.tsx`
- Overlay components: `apps/web/src/components/overlay/`
- Routed adapter helpers: `apps/web/src/routedOverlayAdapters.tsx`
