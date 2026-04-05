import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getSidebarReferenceWidth } from "~/lib/persistedPanelWidth";

import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
} from "./sidebar";

function measuredElement(width: number, parentElement: any = null) {
  return {
    getBoundingClientRect: () => ({ width }),
    parentElement,
  } as HTMLElement;
}

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses a pointer cursor for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for menu actions", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuAction aria-label="Create thread">
        <span>+</span>
      </SidebarMenuAction>,
    );

    expect(html).toContain('data-slot="sidebar-menu-action"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
  });
});

describe("sidebar reference width", () => {
  it("uses the wrapper width when the wrapper is materially wider than the sidebar", () => {
    const parent = measuredElement(1200);
    const wrapper = measuredElement(960, parent);
    const sidebarContainer = measuredElement(320);

    expect(getSidebarReferenceWidth({ sidebarContainer, wrapper })).toBe(960);
  });

  it("falls back to the parent layout width when the wrapper tracks the sidebar width", () => {
    const parent = measuredElement(900);
    const wrapper = measuredElement(320, parent);
    const sidebarContainer = measuredElement(320);

    expect(getSidebarReferenceWidth({ sidebarContainer, wrapper })).toBe(900);
  });
});
