# T3 Code Design Language

> **Purpose**: Prescriptive reference for generating UIs that look native to T3 Code.
> **Audience**: LLMs generating React + Tailwind CSS 4 code inside this codebase.
> **Rule**: Always use existing UI primitives from `~/components/ui/`. Never invent custom components when a primitive exists.

---

## 1. Design Philosophy & Identity

**Aesthetic**: Compact, professional developer-tool UI. Subtle depth via noise textures and layered inset shadows. Clean but not sterile — every surface has a hint of physicality.

**Principles**:

- **Performance-first**: CSS transitions only. No JavaScript animation libraries.
- **Density over spaciousness**: This is a tool, not a marketing page. Tight gaps, compact controls.
- **Dark mode as first-class citizen**: Every color token has a dark variant. Design for dark first.
- **Predictable interactions**: Consistent hover/focus/pressed states across all components.
- **Semantic tokens only**: Never use raw color values — always use CSS custom property tokens.

**Tone keywords**: Utilitarian, precise, restrained, functional.

**What it is NOT**:

- Not playful, not maximalist, not consumer-app soft.
- No `rounded-3xl` bubbly cards. No gradient hero sections. No large decorative illustrations.
- No scale-on-hover effects. No bouncing animations. No confetti.

---

## 2. Color System

### Semantic Tokens

| Token                    | Light Mode                                                             | Dark Mode                                                              |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--background`           | `var(--color-white)`                                                   | `color-mix(in srgb, var(--color-neutral-950) 95%, var(--color-white))` |
| `--foreground`           | `var(--color-neutral-800)`                                             | `var(--color-neutral-100)`                                             |
| `--card`                 | `var(--color-white)`                                                   | `color-mix(in srgb, var(--background) 98%, var(--color-white))`        |
| `--card-foreground`      | `var(--color-neutral-800)`                                             | `var(--color-neutral-100)`                                             |
| `--popover`              | `var(--color-white)`                                                   | `color-mix(in srgb, var(--background) 98%, var(--color-white))`        |
| `--popover-foreground`   | `var(--color-neutral-800)`                                             | `var(--color-neutral-100)`                                             |
| `--primary`              | `oklch(0.488 0.217 264)`                                               | `oklch(0.588 0.217 264)`                                               |
| `--primary-foreground`   | `var(--color-white)`                                                   | `var(--color-white)`                                                   |
| `--secondary`            | `--alpha(var(--color-black) / 4%)`                                     | `--alpha(var(--color-white) / 4%)`                                     |
| `--secondary-foreground` | `var(--color-neutral-800)`                                             | `var(--color-neutral-100)`                                             |
| `--muted`                | `--alpha(var(--color-black) / 4%)`                                     | `--alpha(var(--color-white) / 4%)`                                     |
| `--muted-foreground`     | `color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-black))` | `color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-white))` |
| `--accent`               | `--alpha(var(--color-black) / 4%)`                                     | `--alpha(var(--color-white) / 4%)`                                     |
| `--accent-foreground`    | `var(--color-neutral-800)`                                             | `var(--color-neutral-100)`                                             |
| `--destructive`          | `var(--color-red-500)`                                                 | `color-mix(in srgb, var(--color-red-500) 90%, var(--color-white))`     |
| `--border`               | `--alpha(var(--color-black) / 8%)`                                     | `--alpha(var(--color-white) / 6%)`                                     |
| `--input`                | `--alpha(var(--color-black) / 10%)`                                    | `--alpha(var(--color-white) / 8%)`                                     |
| `--ring`                 | `transparent`                                                          | `transparent`                                                          |

### Status Colors

| Status          | Color                      | Foreground (Light)         | Foreground (Dark)          |
| --------------- | -------------------------- | -------------------------- | -------------------------- |
| `--info`        | `var(--color-blue-500)`    | `var(--color-blue-700)`    | `var(--color-blue-400)`    |
| `--success`     | `var(--color-emerald-500)` | `var(--color-emerald-700)` | `var(--color-emerald-400)` |
| `--warning`     | `var(--color-amber-500)`   | `var(--color-amber-700)`   | `var(--color-amber-400)`   |
| `--destructive` | `var(--color-red-500)`     | `var(--color-red-700)`     | `var(--color-red-400)`     |

### Alpha Conventions

- **Borders**: 8% black (light) / 6% white (dark) — always semi-transparent, never solid gray.
- **Inputs**: 10% black (light) / 8% white (dark).
- **Muted/secondary/accent backgrounds**: 4% black (light) / 4% white (dark).
- **Backdrop overlays**: `bg-black/32 backdrop-blur-sm`.

### Color Usage Rules

| Intent                                       | Use                                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| Primary action background                    | `bg-primary text-primary-foreground`                         |
| Subtle interactive surface (hover, selected) | `bg-accent text-accent-foreground`                           |
| Muted background (section, code block)       | `bg-muted`                                                   |
| Descriptive/secondary text                   | `text-muted-foreground`                                      |
| Placeholder text                             | `text-muted-foreground/72`                                   |
| Error/destructive                            | `text-destructive-foreground` or `bg-destructive text-white` |
| Status badge (e.g. info)                     | `bg-info/8 text-info-foreground dark:bg-info/16`             |

---

## 3. Typography

### Font Families

```
UI:   "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif
Code: "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace
```

### Size Scale

| Tailwind Class | Use Case                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| `text-xs`      | Badges, keyboard shortcuts (`<Kbd>`), field descriptions, section labels, group labels     |
| `text-sm`      | **Default body text**, labels, descriptions, menu items, button text (at `sm:` breakpoint) |
| `text-base`    | Button text (base breakpoint), input text (base breakpoint), toggle text                   |
| `text-lg`      | Card titles, popover titles                                                                |
| `text-xl`      | Dialog titles, empty state titles                                                          |

All text components use responsive sizing: `text-base` at base, `sm:text-sm` at the `sm` breakpoint. This is a universal pattern — buttons, inputs, menu items, badges all follow it.

### Weight Conventions

| Weight           | Use                                                                          |
| ---------------- | ---------------------------------------------------------------------------- |
| `font-medium`    | Labels, buttons, nav items, toast titles, section labels, keyboard shortcuts |
| `font-semibold`  | Card titles, dialog titles, empty state titles, settings section headings    |
| (no `font-bold`) | Never used in UI components                                                  |

### Text Color Hierarchy

```
text-foreground           → Primary content (titles, body text)
text-muted-foreground     → Secondary content (descriptions, timestamps)
text-muted-foreground/72  → Placeholders, subtle hints
text-muted-foreground/50  → Disabled-looking text
```

### Settings Section Labels

Section headers in settings use a specific uppercase micro-label style:

```
text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground
```

---

## 4. Spacing & Density

**Philosophy**: Compact. Tight gaps. This is a developer tool, not a magazine.

### Gap Patterns

| Gap       | Use                                                                                  |
| --------- | ------------------------------------------------------------------------------------ |
| `gap-0.5` | Toast title + description                                                            |
| `gap-1`   | Inline icon + text in small badges                                                   |
| `gap-1.5` | Tight list items, card header title-to-description, inline icon + text               |
| `gap-2`   | Standard component internals (button icon + text, menu items, field label + control) |
| `gap-3`   | Within settings sections (`space-y-3`), between section header and content           |
| `gap-4`   | Form fields in dialogs (`space-y-4`), empty state content sections                   |
| `gap-6`   | Major page sections, between settings sections, empty state header-to-content        |

### Padding Patterns

| Padding        | Use                                                                                |
| -------------- | ---------------------------------------------------------------------------------- |
| `px-2 py-1`    | Menu items, tooltip viewport                                                       |
| `px-2.5 py-2`  | Kanban cards                                                                       |
| `px-3 py-2`    | Headers, toolbars                                                                  |
| `px-3.5 py-3`  | Toast content                                                                      |
| `px-4 py-4`    | Settings rows                                                                      |
| `p-6`          | Card sections (header, panel, footer), dialog header/panel/footer, page containers |
| `px-3 sm:px-5` | Responsive header padding                                                          |

### Page Layout

- Content areas: `max-w-4xl` centered with `mx-auto`.
- Page container: `flex-1 overflow-y-auto p-6` → inner: `mx-auto flex w-full max-w-4xl flex-col gap-6`.

---

## 5. Border & Radius System

### Radius Scale

| Token         | Value                               | Use                                                                      |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `rounded-sm`  | `calc(var(--radius) - 4px)` = ~6px  | Small controls, checkboxes, menu items, badges                           |
| `rounded-md`  | `calc(var(--radius) - 2px)` = ~8px  | Tooltips, icon-xs buttons, small popovers                                |
| `rounded-lg`  | `var(--radius)` = 10px              | **Buttons, inputs, cards (in frames), menus, popovers, selects, toasts** |
| `rounded-xl`  | `calc(var(--radius) + 4px)` = ~14px | Alerts, nested card corners within card frames                           |
| `rounded-2xl` | `calc(var(--radius) + 8px)` = ~18px | **Cards, dialogs, alert dialogs, settings section containers**           |

### Border Color

Always semi-transparent. Use the `border-border` token (set via `@apply border-border` on `*` in base layer).

- Light: `--alpha(var(--color-black) / 8%)`
- Dark: `--alpha(var(--color-white) / 6%)`

**Never use** solid gray borders like `border-gray-200` or `border-neutral-700`.

### Border Usage

- Sidebar: `border-r` (right edge separator)
- Headers/toolbars: `border-b` (bottom separator)
- Cards, dialogs, popups: `border` (full border)
- Settings rows: `border-t border-border first:border-t-0` (top divider between rows)
- Kanban columns: `border-r` (column separator)
- Separators: `bg-border` via `<Separator />` component (not `border-*`)

---

## 6. Shadows & Depth

### Shadow Scale

| Shadow                  | Use                                                         |
| ----------------------- | ----------------------------------------------------------- |
| `shadow-xs/5`           | Inputs, cards, badges (outline), selects, toggles (outline) |
| `shadow-sm/5`           | Switch thumb, empty state icon media                        |
| `shadow-md/5`           | Tooltips                                                    |
| `shadow-lg/5`           | Dialogs, popovers, menus, select popups, toasts, sheets     |
| `shadow-primary/24`     | Primary buttons only (colored shadow glow)                  |
| `shadow-destructive/24` | Destructive buttons only                                    |

### Inset Shadow Pattern

Buttons and cards use a 1px inset highlight for subtle 3D depth:

```
/* Light mode */
before:shadow-[0_1px_--theme(--color-black/4%)]

/* Dark mode */
dark:before:shadow-[0_-1px_--theme(--color-white/6%)]
```

This is applied via a `before:` pseudo-element with `before:pointer-events-none before:absolute before:inset-0`.

Primary/destructive buttons add a top-edge highlight:

```
not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)]
```

### Noise Texture

The `body::after` has a fixed SVG fractal noise overlay at **3.5% opacity**. This is global — do NOT add additional noise or grain to generated UIs.

### Z-Index Layers

- Base content: default
- Sidebar: default (rendered in flow)
- Modals/dialogs/popovers/menus: `z-50`
- Toasts: `z-50` with per-toast `z-[calc(9999-var(--toast-index))]`

---

## 7. Component Patterns

> All components use `data-slot="component-name"` attributes for semantic CSS targeting.
> All components use `cn()` from `~/lib/utils` for class merging (tailwind-merge + CVA).

### Button

**Import**: `import { Button } from "~/components/ui/button"`

**Variants**: `default` | `destructive` | `destructive-outline` | `outline` | `secondary` | `ghost` | `link`

**Sizes**: `default` (h-9/sm:h-8) | `sm` (h-8/sm:h-7) | `lg` (h-10/sm:h-9) | `xl` (h-11/sm:h-10) | `xs` (h-7/sm:h-6) | `icon` (size-9/sm:size-8) | `icon-sm` | `icon-lg` | `icon-xl` | `icon-xs`

**States**:

- Hover/pressed: `[:hover,[data-pressed]]` — background opacity shift (e.g. `bg-primary/90`)
- Focus: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`
- Disabled: `disabled:pointer-events-none disabled:opacity-64`
- Transition: `transition-shadow` only

**Usage**:

```tsx
<Button variant="default">Save</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="ghost" size="icon"><XIcon /></Button>
<Button variant="destructive">Delete</Button>
```

### Input

**Import**: `import { Input } from "~/components/ui/input"`

**Sizes**: `"sm"` | `"default"` | `"lg"`

**Structure**: Outer `<span data-slot="input-control">` wrapping inner `<input data-slot="input">`. The outer span carries all visual styling (border, shadow, ring).

**Key classes on outer span**:

```
rounded-lg border border-input bg-background shadow-xs/5
has-focus-visible:border-ring has-focus-visible:ring-[3px] ring-ring/24
has-aria-invalid:border-destructive/36
has-disabled:opacity-64
dark:bg-input/32
```

### Textarea

**Import**: `import { Textarea } from "~/components/ui/textarea"`

Same visual pattern as Input. Sizes: `"sm"` | `"default"` | `"lg"`. Uses `field-sizing-content` for auto-height.

### Select

**Import**: `import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "~/components/ui/select"`

**Variants**: `default` (full-width, bordered) | `ghost` (transparent, minimal)

**Sizes**: `default` | `sm` | `lg` | `xs`

**Structure**:

```tsx
<Select value={value} onValueChange={setValue}>
  <SelectTrigger variant="default" size="default">
    <SelectValue placeholder="Select..." />
  </SelectTrigger>
  <SelectPopup>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
  </SelectPopup>
</Select>
```

### Checkbox

**Import**: `import { Checkbox } from "~/components/ui/checkbox"`

Size: `size-4.5 sm:size-4`. Rounded: `rounded-[.25rem]`. When checked: `bg-primary text-primary-foreground`.

### Switch

**Import**: `import { Switch } from "~/components/ui/switch"`

Thumb sizes: `--thumb-size: --spacing(5)` (base), `--spacing(4)` (sm breakpoint). Checked: `bg-primary`. Unchecked: `bg-input`.

### Label

**Import**: `import { Label } from "~/components/ui/label"`

Classes: `inline-flex items-center gap-2 text-base/4.5 sm:text-sm/4 font-medium text-foreground`.

### Field

**Import**: `import { Field, FieldLabel, FieldDescription, FieldError } from "~/components/ui/field"`

Structure:

```tsx
<Field>
  <FieldLabel>Email</FieldLabel>
  <Input type="email" />
  <FieldDescription>We'll never share your email.</FieldDescription>
  <FieldError>Invalid email address.</FieldError>
</Field>
```

Field layout: `flex flex-col items-start gap-2`. Description: `text-muted-foreground text-xs`. Error: `text-destructive-foreground text-xs`.

### Dialog

**Import**: `import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter } from "~/components/ui/dialog"`

**Structure**:

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogPopup>
    <DialogHeader>
      <DialogTitle>Edit Profile</DialogTitle>
      <DialogDescription>Make changes to your profile.</DialogDescription>
    </DialogHeader>
    <DialogPanel>
      <div className="space-y-4">{/* form fields */}</div>
    </DialogPanel>
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Save</Button>
    </DialogFooter>
  </DialogPopup>
</Dialog>
```

**Key details**:

- Max width: `max-w-lg`
- Rounded: `rounded-2xl`
- Backdrop: `bg-black/32 backdrop-blur-sm`
- Enter/exit: `data-starting-style:scale-98 data-starting-style:opacity-0` / `data-ending-style:scale-98 data-ending-style:opacity-0`
- Transition: `transition-[scale,opacity,translate] duration-200 ease-in-out`
- Footer default variant: `border-t bg-muted/72 py-4`
- Footer bare variant: no border, just padding
- Has built-in close button (top-right ghost icon button)
- Mobile: bottom-sticks on small screens (`max-sm:` overrides)
- Nested dialogs scale down: `scale-[calc(1-0.1*var(--nested-dialogs))]`

### Alert Dialog

**Import**: `import { AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose } from "~/components/ui/alert-dialog"`

Same structure and animation as Dialog. Header text is centered on mobile: `text-center max-sm:pb-4 sm:text-left`. No built-in close button — use explicit `AlertDialogClose` in footer.

### Popover

**Import**: `import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle, PopoverDescription } from "~/components/ui/popover"`

**Structure**:

```tsx
<Popover>
  <PopoverTrigger render={<Button variant="outline" />}>Open</PopoverTrigger>
  <PopoverPopup side="bottom" align="start" sideOffset={4}>
    <PopoverTitle>Title</PopoverTitle>
    <PopoverDescription>Description text</PopoverDescription>
    {/* content */}
  </PopoverPopup>
</Popover>
```

**Key details**:

- Popup viewport: `px-4 py-4` (default) or `px-2 py-1` (tooltipStyle)
- Rounded: `rounded-lg` (default) or `rounded-md` (tooltipStyle)
- Shadow: `shadow-lg/5`
- Enter/exit: `data-starting-style:scale-98 data-starting-style:opacity-0`
- Has `tooltipStyle` prop for compact tooltip-like appearance

### Menu / Dropdown

**Import**: `import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuCheckboxItem, MenuSeparator, MenuShortcut, MenuSub, MenuSubTrigger, MenuSubPopup } from "~/components/ui/menu"`

Also exported as `DropdownMenu`, `DropdownMenuTrigger`, etc.

**Structure**:

```tsx
<Menu>
  <MenuTrigger render={<Button variant="outline" />}>Options</MenuTrigger>
  <MenuPopup side="bottom" align="start">
    <MenuItem>New File</MenuItem>
    <MenuItem>New Folder</MenuItem>
    <MenuSeparator />
    <MenuCheckboxItem checked={checked} onCheckedChange={setChecked}>
      Show Hidden
    </MenuCheckboxItem>
    <MenuSeparator />
    <MenuItem variant="destructive">
      Delete <MenuShortcut>⌫</MenuShortcut>
    </MenuItem>
  </MenuPopup>
</Menu>
```

**Key details**:

- Min width: `min-w-32`
- Item padding: `px-2 py-1`, min height: `min-h-8 sm:min-h-7`
- Highlight: `data-highlighted:bg-accent data-highlighted:text-accent-foreground`
- Destructive: `data-[variant=destructive]:text-destructive-foreground`
- Separator: `mx-2 my-1 h-px bg-border`
- Shortcut text: `ms-auto text-muted-foreground/72 text-xs tracking-widest`

### Card

**Import**: `import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter, CardAction } from "~/components/ui/card"`

**Structure**:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Description text.</CardDescription>
    <CardAction>{/* optional top-right action */}</CardAction>
  </CardHeader>
  <CardPanel>{/* main content */}</CardPanel>
  <CardFooter>{/* footer actions */}</CardFooter>
</Card>
```

**Key details**:

- Rounded: `rounded-2xl`
- Shadow: `shadow-xs/5`
- All sections: `p-6`
- Smart padding collapse: when CardHeader + CardPanel exist together, bottom/top padding reduces automatically via `:has()` selectors

**CardFrame**: Groups multiple Cards into a stacked frame with shared border and subtle muted background between cards.

### Badge

**Import**: `import { Badge } from "~/components/ui/badge"`

**Variants**: `default` | `secondary` | `outline` | `destructive` | `info` | `success` | `warning` | `error`

**Sizes**: `default` (h-5.5/sm:h-4.5) | `sm` (h-5/sm:h-4) | `lg` (h-6.5/sm:h-5.5)

Status badge pattern: `bg-{status}/8 text-{status}-foreground dark:bg-{status}/16`

### Alert

**Import**: `import { Alert, AlertTitle, AlertDescription, AlertAction } from "~/components/ui/alert"`

**Variants**: `default` | `info` | `success` | `warning` | `error`

**Structure**:

```tsx
<Alert variant="warning">
  <TriangleAlertIcon />
  <AlertTitle>Warning</AlertTitle>
  <AlertDescription>Something needs attention.</AlertDescription>
  <AlertAction>
    <Button size="xs" variant="outline">
      Fix
    </Button>
  </AlertAction>
</Alert>
```

Rounded: `rounded-xl`. Status variants use `border-{status}/32 bg-{status}/4`.

### Toast

**Import**: `import { toastManager } from "~/components/ui/toast"`

**Usage** (imperative):

```tsx
toastManager.add({ title: "Saved", type: "success" });
toastManager.add({ title: "Error", description: "Something went wrong", type: "error" });
```

**Types**: `success` | `error` | `warning` | `info` | `loading`

Toasts are stack-based with `cubic-bezier(.22,1,.36,1)` spring easing, swipe-to-dismiss, and position support (default: `top-right`).

### Tooltip

**Import**: `import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip"`

**Structure**:

```tsx
<Tooltip>
  <TooltipTrigger render={<Button variant="ghost" size="icon" />}>
    <InfoIcon />
  </TooltipTrigger>
  <TooltipPopup side="top" sideOffset={4}>
    Helpful information
  </TooltipPopup>
</Tooltip>
```

Rounded: `rounded-md`. Shadow: `shadow-md/5`. Text: `text-xs`. Compact padding: `px-2 py-1`.

### Empty State

**Import**: `import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "~/components/ui/empty"`

**Structure**:

```tsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon">
      <InboxIcon />
    </EmptyMedia>
    <EmptyTitle>No items yet</EmptyTitle>
    <EmptyDescription>Create your first item to get started.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button>Create Item</Button>
  </EmptyContent>
</Empty>
```

Centered flex layout. `EmptyMedia variant="icon"` renders a small card-like icon with two decorative rotated shadow copies behind it.

### Collapsible

**Import**: `import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "~/components/ui/collapsible"`

Panel animation: `h-(--collapsible-panel-height) transition-[height] duration-200`. Enter/exit: `data-starting-style:h-0 data-ending-style:h-0`.

### Scroll Area

**Import**: `import { ScrollArea } from "~/components/ui/scroll-area"`

**Props**: `scrollFade` (boolean — adds 1.5rem fade mask at edges), `scrollbarGutter`, `hideScrollbars`.

Scrollbar: 6px width (`w-1.5`), thumb: `bg-foreground/20`, shows on hover/scroll with 300ms delay.

### Skeleton

**Import**: `import { Skeleton } from "~/components/ui/skeleton"`

Shimmer gradient animation at 2s cycle. Rounded: `rounded-sm`. Apply dimensions via className:

```tsx
<Skeleton className="h-4 w-48" />
<Skeleton className="h-8 w-full" />
```

### Spinner

**Import**: `import { Spinner } from "~/components/ui/spinner"`

Uses `Loader2Icon` with `animate-spin`. Add size via className: `<Spinner className="size-4" />`.

### Separator

**Import**: `import { Separator } from "~/components/ui/separator"`

Horizontal (default): `h-px w-full bg-border`. Vertical: `w-px self-stretch bg-border`.

### Kbd (Keyboard Shortcut)

**Import**: `import { Kbd } from "~/components/ui/kbd"`

```tsx
<Kbd>⌘</Kbd><Kbd>K</Kbd>
```

Classes: `h-5 min-w-5 rounded bg-muted px-1 font-medium font-sans text-muted-foreground text-xs`.

---

## 8. Animation & Transitions

### Duration Map

| Duration       | Use                                                      |
| -------------- | -------------------------------------------------------- |
| `duration-200` | Dialogs, popovers, collapsibles, switches, alert dialogs |
| `duration-150` | Switch thumb (`translate .15s, border-radius .15s`)      |
| `duration-100` | Scrollbar fade-in on hover/scroll                        |
| `2s`           | Skeleton shimmer (infinite loop)                         |
| `300ms delay`  | Scrollbar reveal delay (hides after 300ms of no scroll)  |
| `.5s`          | Toast slide-in/out with `cubic-bezier(.22,1,.36,1)`      |

### Easing Functions

| Easing                      | Use                                    |
| --------------------------- | -------------------------------------- |
| `ease-in-out`               | Dialogs, alert dialogs                 |
| `ease-out`                  | Backdrops, list reorder (auto-animate) |
| `cubic-bezier(.22,1,.36,1)` | Toasts (spring-like)                   |
| `linear`                    | Skeleton shimmer, spinner              |

### Standard Enter/Exit Pattern

Used by dialogs, popovers, tooltips, toasts:

```
data-starting-style:scale-98 data-starting-style:opacity-0
data-ending-style:scale-98 data-ending-style:opacity-0
transition-[scale,opacity,translate] duration-200 ease-in-out
```

### Backdrop Animation

```
transition-all duration-200
data-starting-style:opacity-0
data-ending-style:opacity-0
```

### Collapsible Animation

```
h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200
data-starting-style:h-0
data-ending-style:h-0
```

### Loading States

- **Spinner**: `<Spinner />` — `animate-spin` on `Loader2Icon`
- **Skeleton**: `<Skeleton className="h-4 w-32" />` — shimmer gradient at 2s cycle
- **No JS animation libraries**: All animation is CSS-driven via Tailwind utilities + Base UI `data-*` attributes

---

## 9. Icons

**Library**: `lucide-react`

**Default styling applied globally on all components**:

```
[&_svg:not([class*='opacity-'])]:opacity-80
[&_svg:not([class*='size-'])]:size-4.5
sm:[&_svg:not([class*='size-'])]:size-4
[&_svg]:pointer-events-none
[&_svg]:shrink-0
```

**Custom brand icons**: `~/components/Icons.tsx` — GitHubIcon, CursorIcon, TraeIcon, VisualStudioCode.

**Usage rules**:

- Always use `lucide-react` icons, not custom SVGs (unless it's a brand logo).
- Icons in buttons: leading position, paired with text (except `size="icon"` variant).
- Icon-only buttons must have `aria-label`.
- Icon negative margin: `[&_svg]:-mx-0.5` is applied by button/menu/badge components.

---

## 10. Layout Patterns

### App Shell

```tsx
<SidebarProvider defaultOpen>
  <Sidebar side="left" resizable>
    {/* sidebar content */}
  </Sidebar>
  <SidebarInset>{/* main page content */}</SidebarInset>
</SidebarProvider>
```

Sidebar: resizable, `border-r`, `bg-card`, `collapsible="offcanvas"` on mobile. Width stored in localStorage.

Electron drag headers that can become the leftmost app chrome when the sidebar is collapsed must include `electron-titlebar-inset` together with `drag-region`. The shared CSS only applies the macOS traffic-light inset when the left sidebar is collapsed and the native window is not fullscreen, keeping expanded-sidebar layouts unchanged. Expanded Electron sidebar headers that sit under macOS traffic lights use `electron-titlebar-sidebar-inset`, which follows the same non-fullscreen rule.

### Page Structure

Every page follows this pattern:

```tsx
<div className="flex min-h-0 flex-1 flex-col">
  {/* Fixed header */}
  <header className="flex h-[50px] items-center justify-between border-b border-border px-3 sm:px-5">
    <div className="flex min-w-0 items-center gap-2">{/* left: sidebar trigger + title */}</div>
    <div className="flex items-center gap-2">{/* right: actions */}</div>
  </header>

  {/* Scrollable body */}
  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{/* page content */}</div>
</div>
```

### Settings Page Layout

```tsx
<SettingsPageContainer>
  {/* renders: flex-1 overflow-y-auto p-6 > mx-auto max-w-4xl flex flex-col gap-6 */}

  <SettingsSection title="APPEARANCE" icon={<PaletteIcon />}>
    <SettingsRow
      title="Theme"
      description="Choose between light, dark, or system theme."
      control={<Select>...</Select>}
    />
    <SettingsRow
      title="Font Size"
      description="Adjust the editor font size."
      control={<Input type="number" />}
    />
  </SettingsSection>
</SettingsPageContainer>
```

SettingsSection: `space-y-3`, header with uppercase `text-[11px]` label, content in a rounded-2xl card with border.
SettingsRow: `border-t first:border-t-0 px-4 py-4 sm:px-5`, 3-column layout on desktop (title/desc, status, control).

### Dialog Form Layout

```tsx
<DialogPanel>
  <div className="space-y-4">
    <Field>
      <FieldLabel>Name</FieldLabel>
      <Input />
    </Field>
    <Field>
      <FieldLabel>Description</FieldLabel>
      <Textarea />
    </Field>
  </div>
</DialogPanel>
<DialogFooter>
  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
  <Button>Create</Button>
</DialogFooter>
```

### Board/Kanban Layout

Horizontal scroll of fixed-width columns:

```tsx
<div className="flex min-h-0 flex-1 overflow-x-auto">
  {columns.map((col) => (
    <div className="flex h-full w-64 shrink-0 flex-col border-r" key={col.id}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium">{col.title}</span>
        <Badge size="sm" variant="outline">
          {col.count}
        </Badge>
      </div>
      <div className="flex-1 overflow-y-auto p-2">{/* cards */}</div>
    </div>
  ))}
</div>
```

Cards: `rounded-md border px-2.5 py-2 flex flex-col gap-1.5`.

---

## 11. Interaction States

### Hover

- Buttons: background opacity shift (`bg-primary/90`), shadow changes. **Never** `hover:scale-*`.
- Menu items: `data-highlighted:bg-accent data-highlighted:text-accent-foreground`.
- Ghost/outline buttons: `[:hover,[data-pressed]]:bg-accent`.
- Links: `hover:opacity-0.8` or `hover:underline`.

### Focus

Keyboard-only focus ring classes may remain in component markup for accessibility compatibility, but `--ring` resolves to `transparent` in the app shell:

```
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background
```

Inputs may keep `has-focus-visible:ring-[3px] ring-ring/24` in their primitive class list, but the token is transparent. The app shell also suppresses the browser default `outline` for `:focus` / `:focus-visible`, so do not replace focus rings with native black outlines, primary/blue rings, or dark neutral rings for ordinary controls.

### Active / Pressed

- `data-pressed` attribute (used by Base UI on buttons, toggles)
- Primary buttons: `[:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)]`
- Shadow removed on press: `[:disabled,:active,[data-pressed]]:shadow-none`

### Disabled

```
disabled:pointer-events-none disabled:opacity-64
```

Also applies to switches: `data-disabled:cursor-not-allowed data-disabled:opacity-64`.

### Selected / Active

- Sidebar items: `isActive` prop → `bg-accent text-accent-foreground`
- Toggle: `data-pressed:bg-input/64 data-pressed:text-accent-foreground`
- Checkbox: `data-checked:bg-primary`
- Switch: `data-checked:bg-primary` / `data-unchecked:bg-input`

### Data Attributes Reference

| Attribute             | Used By                            | Meaning                                   |
| --------------------- | ---------------------------------- | ----------------------------------------- |
| `data-slot`           | All components                     | Semantic identification for CSS targeting |
| `data-pressed`        | Button, Toggle                     | Currently pressed/active                  |
| `data-highlighted`    | MenuItem, SelectItem               | Keyboard/hover highlighted                |
| `data-checked`        | Checkbox, Switch, MenuCheckboxItem | Checked state                             |
| `data-unchecked`      | Switch                             | Unchecked state                           |
| `data-indeterminate`  | Checkbox                           | Indeterminate state                       |
| `data-disabled`       | All interactive                    | Disabled state                            |
| `data-open`           | Collapsible                        | Panel is open                             |
| `data-starting-style` | Dialog, Popover, Tooltip           | Mount animation start                     |
| `data-ending-style`   | Dialog, Popover, Tooltip           | Unmount animation end                     |
| `data-nested`         | Dialog                             | Dialog is nested inside another dialog    |
| `data-expanded`       | Toast                              | Toast stack is expanded (on hover)        |
| `data-variant`        | MenuItem, Badge, Alert             | Current variant name                      |

---

## 12. Dynamic Chat UI Artifacts

Dynamic chat UI artifacts are experimental, highly interactive responses rendered inline in the chat timeline. They are generated as durable assistant message metadata, referenced by a small `t3:dynamic-chat-ui` marker block, and displayed in a sandboxed iframe.

This file is the shipped Dynamic UI design guide. Settings -> Prompts -> Dynamic UI can store `settings.dynamicChatUi.designGuideOverride`; when present, the hidden builder uses that override instead of this file. The same section also exposes the builder prompt wrapper via `settings.dynamicChatUi.builderPromptOverride`. Resetting either setting returns generation to the shipped original.

### Chat Constraints

- The artifact container must be `width: 100%`, `min-width: 0`, and `max-width: 800px`.
- The chat column can resize; generated UI must remain usable at roughly 320px, 520px, and 800px widths.
- Use compact, card-like layouts. Avoid full-page app shells, heroes, and large whitespace.
- Prefer one primary interactive region per artifact: a table, simulator, chart panel, or tabbed explorer.
- Dense tables may scroll horizontally inside the artifact, but the chat timeline itself must not gain horizontal overflow.
- The default height should be useful without being huge. Artifacts may request height via the iframe bridge, but the host caps inline height.
- Artifact source lives in assistant message metadata (`dynamicChatUiArtifacts`) so marker blocks stay compact and generated HTML cannot break markdown fences. Legacy full-HTML marker blocks are still supported as a fallback.

### Allowed Artifact Shapes

Good candidates:

- Responsive data tables with sticky or compact headers.
- Simulation cards with sliders, numeric inputs, and computed values.
- Tabbed chart cards with line, bar, or area charts.
- Weighted decision matrices.
- Pricing or model-cost calculators.
- Benchmark explorers.
- Incident or migration timelines.
- API response explorers.
- Risk/scenario simulators.

### Runtime Expectations

- Generated HTML/JS runs inside an iframe with script execution enabled.
- Do not assume same-origin access to the parent app.
- The iframe host injects T3 color variables for generated HTML:
  - Neutral surfaces: `--t3-background`, `--t3-card`, `--t3-muted`, `--t3-border`
  - Text: `--t3-foreground`, `--t3-muted-foreground`
  - Accents/status: `--t3-primary`, `--t3-info`, `--t3-success`, `--t3-warning`, `--t3-destructive`
- Use neutral surfaces for panels and cards: transparent, `var(--t3-card)`, or `var(--t3-muted)`. Do not create blue, slate, navy, indigo, or tinted "ops dashboard" backgrounds.
- Reserve status colors for narrow accents, badges, dots, chart lines, and critical markers. Never wash full cards or sections with status color.
- Use `window.t3ChatUi.postHeight(height)` when custom sizing is needed.
- Use `window.t3ChatUi.emit(name, payload)` for future host-visible events.
- Height changes must be announced through the bridge so the virtualized chat timeline can remeasure the row without scroll jumps.
- Keep external network access out of generated artifacts unless a later explicit setting allows it.
- Bundle or inline all styles required for the artifact. The iframe does not inherit Tailwind classes from the parent document.
- Match T3 Code visually by using compact spacing, subtle borders, restrained shadows, semantic-looking status colors, and the typography guidance in this document.

### Experimental Limits

- Network access: generated artifacts must not fetch remote scripts, fonts, images, stylesheets, or data. Inline all CSS, JS, SVG, and sample data.
- Imports: do not use React, JSX, module imports, CDNs, Tailwind runtime classes, or external UI libraries. Use native DOM, SVG, and canvas.
- Bundle size: keep `html` under 400,000 characters. Prefer small focused artifacts; avoid embedding large datasets or generated libraries.
- Height: choose `initialHeight` close to the expected first render. The chat wrapper measures the iframe content and lets it grow or shrink to fit; do not rely on a fixed cap.
- Size artifacts to their actual content. Do not use `height: 100vh`, `min-height: 100vh`, `100dvh`, or full-screen spacer roots inside chat artifacts; those make the iframe reserve blank space below the UI.
- Do not inflate `initialHeight` or add hidden spacer elements to create visual breathing room.
- Timeouts: generated code must initialize quickly and should avoid long synchronous loops, large animation workloads, polling, or timers that run continuously.
- Safety posture: this path is intentionally unsafe and experimental, but artifacts still run in a sandboxed iframe and should communicate only through the `window.t3ChatUi` bridge.

### Fenced Block Format

````
```t3:dynamic-chat-ui
{
  "version": 1,
  "id": "pricing-simulator",
  "title": "Pricing simulator",
  "description": "Adjust usage and margin assumptions.",
  "initialHeight": 360,
  "maxHeight": 700,
  "html": "<!doctype html><html>...</html>"
}
```
````

### Builder API

Agents can call `/api/dynamic-chat-ui`:

- `create_dynamic_chat_ui_from_prompt` accepts a natural-language UI request plus required `title` and `description`, optional `data`/`context`, loads this design guide, calls the configured secondary model, and inserts the generated artifact directly into the chat timeline.
- `description` must briefly describe what is being built because it appears in the generating timeline card before the hidden builder finishes.
- While generation runs, T3 inserts a compact pending message and replaces that same timeline item with the final iframe artifact on success or a short failure note on error.
- The calling agent receives a compact success payload. It should not echo HTML, JSON, or `t3:dynamic-chat-ui` blocks back to the user.

The low-level HTML validation and block serialization path is intentionally internal. The chat agent should describe the desired interface and data to the builder instead of hand-authoring artifact HTML.

For revisions, the same tool accepts `sourceArtifactId` and optional `sourceMessageId`. T3 resolves the prior artifact from the current thread, resumes the hidden builder session keyed to that artifact when possible, and asks the builder for a complete replacement artifact. The parent chat agent should describe the requested change in `prompt`; it should not paste the old HTML back into the request.

---

## 13. Anti-Patterns

**Do NOT**:

- Use `rounded-full` on cards or containers (only for avatars, switch thumbs, and pill indicators).
- Use gradient backgrounds on panels, cards, or sections.
- Use blue/slate/navy/indigo tinted backgrounds for panels or dashboard cards; T3 surfaces are neutral, with color reserved for accents.
- Add noise/grain textures — the global `body::after` overlay handles it.
- Use `framer-motion`, `motion`, or any JavaScript animation library.
- Use solid opaque borders like `border-gray-200` — always use `border-border` (semi-transparent).
- Use raw color values like `bg-blue-500` — always use semantic tokens (`bg-primary`, `bg-info`, etc.).
- Use font sizes larger than `text-xl` for anything (no `text-2xl`, `text-3xl`, etc.).
- Add excessive whitespace — maintain compact density. If it looks like a marketing page, it's wrong.
- Create custom color values with arbitrary hex — use the existing token system.
- Add `hover:scale-*` effects on interactive elements.
- Use `box-shadow` for elevation on dark mode — use inset shadows and border-based depth.
- Use `font-bold` or `font-black` — the heaviest weight in the system is `font-semibold`.
- Import components from external UI libraries — always use the primitives in `~/components/ui/`.
- Create new CSS keyframe animations — use existing Tailwind utilities.
- Use `z-index` values outside the established layering (base, z-50 for overlays).
