import type { BrowserWindow } from "electron";

export interface ExtensionPopupCdpSubscription {
  readonly closeWithError: (error: unknown, code?: string) => void;
}

export interface ExtensionPopupProjectState {
  activeExtensionPopupKey: string | null;
}

export type ExtensionPopupKind = "action" | "extension-window";

export interface ExtensionPopupSelector {
  readonly extensionId?: string;
  readonly popupKey?: string;
}

export interface ExtensionPopupState {
  readonly popupKey: string;
  readonly projectId: string;
  readonly extensionId: string;
  readonly kind: ExtensionPopupKind;
  readonly popupWin: BrowserWindow;
  readonly subscriptions: Set<ExtensionPopupCdpSubscription>;
  readonly createdAt: number;
  devtoolsOpen: boolean;
  debuggerAttached: boolean;
}

export interface ExtensionPopupWindowInfo {
  readonly popupKey: string;
  readonly extensionId: string;
  readonly popupType: ExtensionPopupKind;
  readonly title: string;
  readonly url: string;
  readonly isActive: boolean;
  readonly createdAt: number;
}

export class ExtensionPopupRegistry {
  private readonly popupsByKey = new Map<string, ExtensionPopupState>();
  private nextPopupId = 1;

  private makePopupKey(): string {
    return `popup-${this.nextPopupId++}`;
  }

  get(popupKey: string): ExtensionPopupState | undefined {
    const popup = this.popupsByKey.get(popupKey);
    if (popup?.popupWin.isDestroyed()) {
      this.popupsByKey.delete(popupKey);
      return undefined;
    }
    return popup;
  }

  has(projectId: string, extensionId: string): boolean {
    return this.popupsForExtension(projectId, extensionId).length > 0;
  }

  getActionPopup(projectId: string, extensionId: string): ExtensionPopupState | undefined {
    return this.popupsForExtension(projectId, extensionId).find((popup) => popup.kind === "action");
  }

  register(
    projectId: string,
    extensionId: string,
    popupWin: BrowserWindow,
    kind: ExtensionPopupKind,
    project?: ExtensionPopupProjectState,
  ): ExtensionPopupState {
    const popupKey = this.makePopupKey();
    const state: ExtensionPopupState = {
      popupKey,
      projectId,
      extensionId,
      kind,
      popupWin,
      subscriptions: new Set(),
      createdAt: Date.now(),
      devtoolsOpen: false,
      debuggerAttached: false,
    };
    this.popupsByKey.set(popupKey, state);

    popupWin.once("closed", () => {
      if (this.popupsByKey.get(popupKey) === state) {
        this.popupsByKey.delete(popupKey);
      }
      if (project?.activeExtensionPopupKey === popupKey) {
        project.activeExtensionPopupKey = null;
      }
      for (const sub of state.subscriptions) {
        sub.closeWithError("Extension popup closed");
      }
      state.subscriptions.clear();
    });

    return state;
  }

  list(projectId: string, activePopupKey: string | null): ExtensionPopupWindowInfo[] {
    const results: ExtensionPopupWindowInfo[] = [];
    for (const [key, popup] of this.popupsByKey) {
      if (popup.popupWin.isDestroyed()) {
        this.popupsByKey.delete(key);
        continue;
      }
      if (popup.projectId !== projectId) continue;
      results.push({
        popupKey: key,
        extensionId: popup.extensionId,
        popupType: popup.kind,
        title: popup.popupWin.webContents.getTitle(),
        url: popup.popupWin.webContents.getURL(),
        isActive: key === activePopupKey,
        createdAt: popup.createdAt,
      });
    }
    return results;
  }

  switchTo(
    projectId: string,
    selector: ExtensionPopupSelector,
    project: ExtensionPopupProjectState,
    devtoolsOpenMessage: string,
  ): { switched: boolean; popupKey: string | null } {
    if (!selector.extensionId && !selector.popupKey) {
      project.activeExtensionPopupKey = null;
      return { switched: true, popupKey: null };
    }

    const popup = this.resolvePopup(projectId, selector, project.activeExtensionPopupKey);

    if (!popup.popupWin.webContents.debugger.isAttached()) {
      try {
        popup.popupWin.webContents.debugger.attach("1.3");
        popup.debuggerAttached = true;
        popup.devtoolsOpen = false;
      } catch (cause) {
        popup.devtoolsOpen = true;
        throw new Error(`Failed to attach debugger to extension popup ${popup.popupKey}`, {
          cause,
        });
      }
    }

    if (popup.devtoolsOpen || !popup.popupWin.webContents.debugger.isAttached()) {
      throw new Error(devtoolsOpenMessage);
    }

    project.activeExtensionPopupKey = popup.popupKey;
    return { switched: true, popupKey: popup.popupKey };
  }

  hideProject(projectId: string): void {
    for (const popup of this.popupsByKey.values()) {
      if (popup.projectId === projectId && !popup.popupWin.isDestroyed()) {
        popup.popupWin.hide();
      }
    }
  }

  showProject(projectId: string): void {
    for (const popup of this.popupsByKey.values()) {
      if (popup.projectId === projectId && !popup.popupWin.isDestroyed()) {
        popup.popupWin.show();
      }
    }
  }

  close(
    projectId: string,
    selector: ExtensionPopupSelector,
    project?: ExtensionPopupProjectState,
  ): void {
    const popup = this.resolvePopup(projectId, selector, project?.activeExtensionPopupKey ?? null);
    if (project?.activeExtensionPopupKey === popup.popupKey) {
      project.activeExtensionPopupKey = null;
    }
    if (popup && !popup.popupWin.isDestroyed()) popup.popupWin.close();
    this.popupsByKey.delete(popup.popupKey);
  }

  closeExtension(
    projectId: string,
    extensionId: string,
    project?: ExtensionPopupProjectState,
  ): void {
    for (const popup of this.popupsForExtension(projectId, extensionId)) {
      if (project?.activeExtensionPopupKey === popup.popupKey) {
        project.activeExtensionPopupKey = null;
      }
      if (!popup.popupWin.isDestroyed()) popup.popupWin.close();
      this.popupsByKey.delete(popup.popupKey);
    }
  }

  closeAll(): void {
    for (const popup of this.popupsByKey.values()) {
      if (!popup.popupWin.isDestroyed()) popup.popupWin.destroy();
    }
    this.popupsByKey.clear();
  }

  private popupsForExtension(projectId: string, extensionId: string): ExtensionPopupState[] {
    const popups: ExtensionPopupState[] = [];
    for (const [key, popup] of this.popupsByKey) {
      if (popup.popupWin.isDestroyed()) {
        this.popupsByKey.delete(key);
        continue;
      }
      if (popup.projectId === projectId && popup.extensionId === extensionId) {
        popups.push(popup);
      }
    }
    return popups;
  }

  private resolvePopup(
    projectId: string,
    selector: ExtensionPopupSelector,
    activePopupKey: string | null,
  ): ExtensionPopupState {
    if (selector.popupKey) {
      const popup = this.get(selector.popupKey);
      if (!popup || popup.projectId !== projectId) {
        throw new Error(`No open extension popup with popupKey ${selector.popupKey}`);
      }
      return popup;
    }

    const extensionId = selector.extensionId;
    if (!extensionId) throw new Error("No extension popup selector provided");
    const matches = this.popupsForExtension(projectId, extensionId);
    if (matches.length === 0) throw new Error(`No open popup for extension ${extensionId}`);
    if (matches.length === 1) return matches[0]!;

    const active = activePopupKey
      ? matches.find((popup) => popup.popupKey === activePopupKey)
      : undefined;
    if (active) return active;

    const actionPopups = matches.filter((popup) => popup.kind === "action");
    if (actionPopups.length === 1) return actionPopups[0]!;

    const popupKeys = matches.map((popup) => popup.popupKey).join(", ");
    throw new Error(
      `Multiple popups are open for extension ${extensionId}; use one popupKey from ext_windows: ${popupKeys}`,
    );
  }
}
