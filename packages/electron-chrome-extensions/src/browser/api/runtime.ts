import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { ExtensionContext } from "../context";
import { ExtensionEvent } from "../router";
import { getExtensionManifest } from "./common";
import { NativeMessagingHost } from "./lib/native-messaging-host";

export class RuntimeAPI extends EventEmitter {
  private hostMap: Record<string, NativeMessagingHost | undefined> = {};

  constructor(private ctx: ExtensionContext) {
    super();

    const handle = this.ctx.router.apiHandler();
    handle("runtime.connectNative", this.connectNative, { permission: "nativeMessaging" });
    handle("runtime.disconnectNative", this.disconnectNative, { permission: "nativeMessaging" });
    handle("runtime.openOptionsPage", this.openOptionsPage);
    handle("runtime.sendNativeMessage", this.sendNativeMessage, { permission: "nativeMessaging" });
    handle("runtime.reload", this.reload.bind(this), { extensionContext: true });
  }

  private connectNative = async (
    event: ExtensionEvent,
    connectionId: string,
    application: string,
  ) => {
    const host = new NativeMessagingHost(
      event.extension.id,
      event.sender!,
      connectionId,
      application,
    );
    this.hostMap[connectionId] = host;
  };

  private disconnectNative = (event: ExtensionEvent, connectionId: string) => {
    this.hostMap[connectionId]?.destroy();
    this.hostMap[connectionId] = undefined;
  };

  private sendNativeMessage = async (event: ExtensionEvent, application: string, message: any) => {
    const connectionId = randomUUID();
    const host = new NativeMessagingHost(
      event.extension.id,
      event.sender!,
      connectionId,
      application,
      false,
    );
    await host.ready;
    return await host.sendAndReceive(message);
  };

  /**
   * Dispatch chrome.runtime.onInstalled to a specific extension.
   * Call this after session.loadExtension() to notify the extension it was installed.
   */
  notifyInstalled(extensionId: string, reason: "install" | "update" | "chrome_update") {
    this.ctx.router.sendEvent(extensionId, "runtime.onInstalled", { reason });
  }

  private async reload(event: ExtensionEvent): Promise<void> {
    const { session } = this.ctx;
    const extPath = (event.extension as unknown as { path?: string }).path;
    if (!extPath) {
      console.warn(`[crx-runtime] reload() called for ${event.extension.id} but path is unknown`);
      return;
    }
    if (typeof this.ctx.store.impl.reloadExtension === "function") {
      await this.ctx.store.impl.reloadExtension(event.extension, extPath);
      return;
    }
    const ses = ((session as unknown as Record<string, unknown>).extensions ?? session) as {
      loadExtension: (p: string, o: object) => Promise<unknown>;
    };
    await ses.loadExtension(extPath, { allowFileAccess: true });
  }

  private openOptionsPage = async ({ extension }: ExtensionEvent) => {
    // TODO: options page shouldn't appear in Tabs API
    // https://developer.chrome.com/extensions/options#tabs-api

    const manifest = getExtensionManifest(extension);

    if (manifest.options_ui) {
      // Embedded option not support (!options_ui.open_in_new_tab)
      const url = `chrome-extension://${extension.id}/${manifest.options_ui.page}`;
      await this.ctx.store.createTab({ url, active: true });
    } else if (manifest.options_page) {
      const url = `chrome-extension://${extension.id}/${manifest.options_page}`;
      await this.ctx.store.createTab({ url, active: true });
    }
  };
}
