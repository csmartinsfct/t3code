import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const BROWSER_MOUNT_CHANNEL = "browser:mount";
const BROWSER_SET_BOUNDS_CHANNEL = "browser:setBounds";
const BROWSER_UNMOUNT_CHANNEL = "browser:unmount";
const BROWSER_SUSPEND_CHANNEL = "browser:suspendForModal";
const BROWSER_RESUME_CHANNEL = "browser:resumeFromModal";
const BROWSER_NAVIGATE_CHANNEL = "browser:navigate";
const BROWSER_GO_BACK_CHANNEL = "browser:goBack";
const BROWSER_GO_FORWARD_CHANNEL = "browser:goForward";
const BROWSER_RELOAD_CHANNEL = "browser:reload";
const BROWSER_GET_URL_CHANNEL = "browser:getUrl";
const BROWSER_LIST_TABS_CHANNEL = "browser:listTabs";
const BROWSER_NEW_TAB_CHANNEL = "browser:newTab";
const BROWSER_SWITCH_TAB_CHANNEL = "browser:switchTab";
const BROWSER_CLOSE_TAB_CHANNEL = "browser:closeTab";
const BROWSER_SET_VIEWPORT_CHANNEL = "browser:setViewport";
const BROWSER_TABS_CHANGED_CHANNEL = "browser:tabsChanged";
const BROWSER_POPOUT_OPEN_CHANNEL = "browser:popout-open";
const BROWSER_POPOUT_CLOSE_CHANNEL = "browser:popout-close";
const BROWSER_POPOUT_STATE_CHANNEL = "browser:popout-state";

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => {
    const result = ipcRenderer.sendSync(GET_WS_URL_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  browser: {
    mount: (projectId, bounds) => ipcRenderer.invoke(BROWSER_MOUNT_CHANNEL, projectId, bounds),
    setBounds: (projectId, bounds) =>
      ipcRenderer.invoke(BROWSER_SET_BOUNDS_CHANNEL, projectId, bounds),
    unmount: (projectId) => ipcRenderer.invoke(BROWSER_UNMOUNT_CHANNEL, projectId),
    suspendForModal: () => ipcRenderer.invoke(BROWSER_SUSPEND_CHANNEL),
    resumeFromModal: () => ipcRenderer.invoke(BROWSER_RESUME_CHANNEL),
    navigate: (projectId, url) => ipcRenderer.invoke(BROWSER_NAVIGATE_CHANNEL, projectId, url),
    goBack: (projectId) => ipcRenderer.invoke(BROWSER_GO_BACK_CHANNEL, projectId),
    goForward: (projectId) => ipcRenderer.invoke(BROWSER_GO_FORWARD_CHANNEL, projectId),
    reload: (projectId) => ipcRenderer.invoke(BROWSER_RELOAD_CHANNEL, projectId),
    getUrl: (projectId) => ipcRenderer.invoke(BROWSER_GET_URL_CHANNEL, projectId),
    listTabs: (projectId) => ipcRenderer.invoke(BROWSER_LIST_TABS_CHANNEL, projectId),
    newTab: (projectId, url) => ipcRenderer.invoke(BROWSER_NEW_TAB_CHANNEL, projectId, url),
    switchTab: (projectId, tabId) =>
      ipcRenderer.invoke(BROWSER_SWITCH_TAB_CHANNEL, projectId, tabId),
    closeTab: (projectId, tabId) => ipcRenderer.invoke(BROWSER_CLOSE_TAB_CHANNEL, projectId, tabId),
    setViewport: (projectId, tabId, params) =>
      ipcRenderer.invoke(BROWSER_SET_VIEWPORT_CHANNEL, projectId, tabId, params),
    popoutOpen: (projectId) => ipcRenderer.invoke(BROWSER_POPOUT_OPEN_CHANNEL, projectId),
    popoutClose: (projectId) => ipcRenderer.invoke(BROWSER_POPOUT_CLOSE_CHANNEL, projectId),
    onTabsChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        listener(payload as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(BROWSER_TABS_CHANGED_CHANNEL, wrapped);
      return () => {
        ipcRenderer.removeListener(BROWSER_TABS_CHANGED_CHANNEL, wrapped);
      };
    },
    onPopoutStateChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        listener(payload as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(BROWSER_POPOUT_STATE_CHANNEL, wrapped);
      return () => {
        ipcRenderer.removeListener(BROWSER_POPOUT_STATE_CHANNEL, wrapped);
      };
    },
  },
} satisfies DesktopBridge);
