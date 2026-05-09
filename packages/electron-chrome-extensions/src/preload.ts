import { injectExtensionAPIs } from "./renderer";

// Only load within extension page context
if (
  process.type === "service-worker" ||
  (typeof location !== "undefined" && location.href.startsWith("chrome-extension://"))
) {
  injectExtensionAPIs();
}
