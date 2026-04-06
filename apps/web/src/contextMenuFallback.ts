import type { ContextMenuItem } from "@t3tools/contracts";

const MENU_CLASS =
  "fixed z-[10000] min-w-[140px] rounded-md border border-border bg-popover py-1 shadow-xl animate-in fade-in zoom-in-95";

function buildMenuButton<T extends string>(
  item: ContextMenuItem<T>,
  cleanup: (result: T | null) => void,
  openSubmenu: ((btn: HTMLElement, children: readonly ContextMenuItem<T>[]) => void) | null,
  closeSubmenu: (() => void) | null,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";

  const hasChildren = item.children && item.children.length > 0;
  const isDestructiveAction = item.destructive === true || item.id === "delete";
  const isDisabled = item.disabled === true && !hasChildren;

  btn.disabled = isDisabled;

  if (hasChildren) {
    const labelSpan = document.createElement("span");
    labelSpan.textContent = item.label;
    const chevron = document.createElement("span");
    chevron.textContent = "\u25B8";
    chevron.style.marginLeft = "auto";
    chevron.style.paddingLeft = "8px";
    btn.appendChild(labelSpan);
    btn.appendChild(chevron);
  } else {
    btn.textContent = item.label;
  }

  btn.className = isDisabled
    ? "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground/60 cursor-not-allowed"
    : isDestructiveAction
      ? "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-destructive hover:bg-accent cursor-default"
      : "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-popover-foreground hover:bg-accent cursor-default";

  if (!isDisabled && !hasChildren) {
    btn.addEventListener("click", () => cleanup(item.id));
  }

  if (hasChildren && item.children && openSubmenu && closeSubmenu) {
    btn.addEventListener("mouseenter", () => {
      openSubmenu(btn, item.children!);
    });
  }

  return btn;
}

/**
 * Imperative DOM-based context menu for non-Electron environments.
 * Shows a positioned dropdown and returns a promise that resolves
 * with the clicked item id, or null if dismissed.
 */
export function showContextMenuFallback<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999";

    const menu = document.createElement("div");
    menu.className = MENU_CLASS;

    const x = position?.x ?? 0;
    const y = position?.y ?? 0;
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;

    let activeSubmenu: HTMLDivElement | null = null;
    let submenuHoverTimeout: ReturnType<typeof setTimeout> | null = null;

    function cleanup(result: T | null) {
      document.removeEventListener("keydown", onKeyDown);
      if (activeSubmenu) activeSubmenu.remove();
      overlay.remove();
      menu.remove();
      resolve(result);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      }
    }

    function closeSubmenu() {
      if (activeSubmenu) {
        activeSubmenu.remove();
        activeSubmenu = null;
      }
    }

    function openSubmenu(parentBtn: HTMLElement, children: readonly ContextMenuItem<T>[]) {
      closeSubmenu();

      const sub = document.createElement("div");
      sub.className = MENU_CLASS;

      const parentRect = parentBtn.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();

      // Position to the right of the parent menu
      let subLeft = menuRect.right - 1;
      let subTop = parentRect.top;

      for (const child of children) {
        const childBtn = buildMenuButton<T>(child, cleanup, null, null);
        sub.appendChild(childBtn);
      }

      sub.style.top = `${subTop}px`;
      sub.style.left = `${subLeft}px`;

      document.body.appendChild(sub);
      activeSubmenu = sub;

      // Adjust if submenu overflows viewport
      requestAnimationFrame(() => {
        const subRect = sub.getBoundingClientRect();
        if (subRect.right > window.innerWidth) {
          // Position to the left of the parent menu instead
          subLeft = menuRect.left - subRect.width + 1;
          sub.style.left = `${subLeft}px`;
        }
        if (subRect.bottom > window.innerHeight) {
          sub.style.top = `${window.innerHeight - subRect.height - 4}px`;
        }
      });

      // Keep submenu open while hovering over it
      sub.addEventListener("mouseenter", () => {
        if (submenuHoverTimeout) clearTimeout(submenuHoverTimeout);
      });
      sub.addEventListener("mouseleave", () => {
        submenuHoverTimeout = setTimeout(() => {
          closeSubmenu();
        }, 150);
      });
    }

    overlay.addEventListener("mousedown", () => cleanup(null));
    document.addEventListener("keydown", onKeyDown);

    for (const item of items) {
      const btn = buildMenuButton<T>(item, cleanup, openSubmenu, closeSubmenu);
      menu.appendChild(btn);
    }

    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    // Adjust if menu overflows viewport
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 4}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 4}px`;
      }
    });
  });
}
