import type { ProjectId } from "@t3tools/contracts";

import { installBrowserHostCommands, type BrowserHostCommand } from "../BrowserHost.ts";

const NOT_IMPLEMENTED =
  "Electron WebContents browser host is not implemented yet. This project is already marked for the embedded browser; native browser tools will become available when T3CO-336d lands.";

export class ElectronWebContentsBrowserHost {
  readonly kind = "electron-wc" as const;

  constructor(readonly projectId: ProjectId) {
    installBrowserHostCommands(this);
  }

  readonly dispose = async (): Promise<void> => {};

  readonly runTool: BrowserHostCommand = async () => {
    throw new Error(NOT_IMPLEMENTED);
  };
}
