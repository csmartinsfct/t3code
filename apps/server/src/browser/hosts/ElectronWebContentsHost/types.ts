export interface CdpClient {
  sendCommand<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface AxValue<T = unknown> {
  type?: string;
  value?: T;
}

export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue<string>;
  name?: AxValue<string>;
  value?: AxValue;
  description?: AxValue<string>;
  properties?: Array<{
    name: string;
    value?: AxValue;
  }>;
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface CdpBoxModel {
  model: {
    content: number[];
    padding: number[];
    border: number[];
    margin: number[];
    width: number;
    height: number;
  };
}

export interface RefTuple {
  role: string;
  name: string;
  nth: number;
  backendNodeId?: number;
}

export interface RefEntry extends RefTuple {
  kind: "ax" | "cursor";
  selector?: string;
}

export interface SnapshotOptions {
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  cursorInteractive?: boolean;
}

export interface SnapshotResult {
  text: string;
  refs: Map<string, RefEntry>;
}

export interface ResolvedRef {
  ref: string;
  entry: RefEntry;
  backendNodeId?: number;
}

export interface ScreenshotResult {
  buffer: Buffer;
  devicePixelRatio: number;
}
