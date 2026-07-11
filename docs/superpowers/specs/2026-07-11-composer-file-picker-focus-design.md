# Composer File Picker Focus Design

## Problem

When the Electron native overlay path is active, typing `@` opens the composer file picker in a separate `WebContentsView`. Acquiring that view focuses it, so subsequent character input no longer reaches the Lexical composer. The user must manually refocus the composer after every character.

The DOM fallback does not have this problem. Its menu prevents pointer-down focus transfer, while the composer continues to own typing and command keys.

## Intended Behavior

- Typing `@` opens the file picker without moving keyboard focus away from the composer.
- Ordinary character input continues updating the composer and filtering the picker.
- Up and Down move the active picker row.
- Tab and Enter select the active row.
- Pointer hover and click continue to work in the native picker.
- Other native overlays retain their current focus-on-open behavior.
- Closing the picker retains the existing host-focus restoration behavior.

## Design

Add an explicit focus policy to native overlay acquisition. The default remains focus-on-acquire so existing menus, dialogs, sheets, and routed overlays keep their current semantics. The composer command overlay opts out because it is a visual extension of the already-focused editor, not an independent keyboard surface.

Pass the policy through the renderer bridge to Electron's overlay pool. When focus-on-acquire is disabled, the pool attaches the overlay `WebContentsView` above the embedded browser without calling `webContents.focus()`. Pointer events still target the topmost overlay view; selecting a result dismisses it and returns control to the host as today.

The composer continues to handle Up, Down, Tab, and Enter through its existing Lexical command plugin. No keyboard forwarding from the overlay is introduced.

## Testing

- Add a failing desktop overlay-pool test proving that non-focusing acquisition attaches the view without focusing it.
- Retain or extend composer browser coverage for Up/Down highlight movement and Tab/Enter selection while the menu is open.
- Verify the focused default remains unchanged for all other overlay callers.
- Run the repository-required `bun fmt`, `bun lint`, and `bun typecheck`, plus focused tests via `bun run test`.

## Documentation

Update `docs/overlays.md` and the overlay section of `docs/browser-tools.md` to document the non-focus-stealing composer-command exception and its keyboard ownership contract.
