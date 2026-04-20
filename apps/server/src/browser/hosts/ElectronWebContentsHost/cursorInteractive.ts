export interface CursorInteractiveElement {
  selector: string;
  text: string;
  reason: string;
}

export const CURSOR_INTERACTIVE_SCAN_SOURCE = `(() => {
  const STANDARD_INTERACTIVE = new Set([
    "A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "DETAILS",
  ]);

  const results = [];
  const allElements = document.querySelectorAll("*");

  for (const el of allElements) {
    if (STANDARD_INTERACTIVE.has(el.tagName)) continue;
    if (!el.offsetParent && el.tagName !== "BODY") continue;

    const style = getComputedStyle(el);
    const hasCursorPointer = style.cursor === "pointer";
    const hasOnclick = el.hasAttribute("onclick");
    const hasTabindex = el.hasAttribute("tabindex") && parseInt(el.getAttribute("tabindex"), 10) >= 0;
    const hasRole = el.hasAttribute("role");

    const isInFloating = (() => {
      let parent = el;
      while (parent && parent !== document.documentElement) {
        const pStyle = getComputedStyle(parent);
        const isFloating = (pStyle.position === "fixed" || pStyle.position === "absolute") &&
          parseInt(pStyle.zIndex || "0", 10) >= 10;
        const hasPortalAttr = parent.hasAttribute("data-floating-ui-portal") ||
          parent.hasAttribute("data-radix-popper-content-wrapper") ||
          parent.hasAttribute("data-radix-portal") ||
          parent.hasAttribute("data-popper-placement") ||
          parent.getAttribute("role") === "listbox" ||
          parent.getAttribute("role") === "menu";
        if (isFloating || hasPortalAttr) return true;
        parent = parent.parentElement;
      }
      return false;
    })();

    if (!hasCursorPointer && !hasOnclick && !hasTabindex) {
      if (isInFloating && hasRole) {
        const role = el.getAttribute("role");
        if (role !== "option" && role !== "menuitem" && role !== "menuitemcheckbox" && role !== "menuitemradio") continue;
      } else {
        continue;
      }
    }
    if (hasRole && !isInFloating) continue;

    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const parent = current.parentElement;
      if (!parent) break;
      const siblings = [...parent.children];
      const index = siblings.indexOf(current) + 1;
      parts.unshift(\`\${current.tagName.toLowerCase()}:nth-child(\${index})\`);
      current = parent;
    }
    const selector = parts.join(" > ");

    const text = el.innerText?.trim().slice(0, 80) || el.tagName.toLowerCase();
    const reasons = [];
    if (isInFloating) reasons.push("popover-child");
    if (hasCursorPointer) reasons.push("cursor:pointer");
    if (hasOnclick) reasons.push("onclick");
    if (hasTabindex) reasons.push(\`tabindex=\${el.getAttribute("tabindex")}\`);
    if (hasRole) reasons.push(\`role=\${el.getAttribute("role")}\`);

    results.push({ selector, text, reason: reasons.join(", ") });
  }
  return results;
})()`;
