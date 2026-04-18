import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors";
import type { ProviderAdapterShape } from "./ProviderAdapter";

export interface GeminiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "gemini";
}

export class GeminiAdapter extends ServiceMap.Service<GeminiAdapter, GeminiAdapterShape>()(
  "t3/provider/Services/GeminiAdapter",
) {}
