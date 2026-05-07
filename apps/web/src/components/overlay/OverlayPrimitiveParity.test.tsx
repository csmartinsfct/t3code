import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { renderOverlayMenuItemsForTests } from "./OverlayMenu";
import { renderOverlaySelectItemsForTests } from "./OverlaySelect";
import type { OverlayBridgeHandle } from "./overlayTypes";

function bridge(): OverlayBridgeHandle {
  return {
    emitEvent: vi.fn(),
    requestDismiss: vi.fn(),
  };
}

describe("overlay primitive parity", () => {
  it("renders high-risk menu item states from serialized overlay data", () => {
    const html = renderToStaticMarkup(
      <>
        <MenuPrimitive.Root open>
          {renderOverlayMenuItemsForTests(
            [
              { id: "label", label: "Section", labelOnly: true },
              {
                id: "refresh",
                label: "Refresh",
                actions: [{ id: "reload", icon: "RefreshCw" }],
              },
              { id: "checked", label: "Checked item", checked: true },
              { id: "danger", label: "Danger", destructive: true },
              { id: "disabled", label: "Disabled", disabled: true },
              { id: "separator", label: "", separator: true },
            ],
            bridge(),
          )}
        </MenuPrimitive.Root>
      </>,
    );

    expect(html).toContain("Section");
    expect(html).toContain("Refresh");
    expect(html).toContain("Checked item");
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain("data-disabled");
  });

  it("does not add native-only width constraints for secondary action rows", () => {
    const html = renderToStaticMarkup(
      <>
        <MenuPrimitive.Root open>
          {renderOverlayMenuItemsForTests(
            [
              {
                id: "run",
                label: "Dev Server",
                icon: "Play",
                secondaryAction: { id: "edit", icon: "Settings", ariaLabel: "Edit Dev Server" },
              },
            ],
            bridge(),
          )}
        </MenuPrimitive.Root>
      </>,
    );

    expect(html).toContain("Dev Server");
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover:opacity-100");
    expect(html).not.toContain("min-w-[15rem]");
    expect(html).not.toContain("max-w-[22rem]");
  });

  it("renders select separators and hide-indicator rows from serialized overlay data", () => {
    const html = renderToStaticMarkup(
      <>
        <SelectPrimitive.Root open value="system">
          {renderOverlaySelectItemsForTests([
            { value: "system", label: "System", hideIndicator: true },
            { value: "separator", label: "", separator: true },
            { value: "dark", label: "Dark" },
          ])}
        </SelectPrimitive.Root>
      </>,
    );

    expect(html).toContain("System");
    expect(html).toContain("Dark");
    expect(html).toContain("grid-cols-[1fr]");
    expect(html).toContain("bg-border");
  });
});
