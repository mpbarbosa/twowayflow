import type { ExtensionToWebview, WebviewToExtension } from "../src/protocol.js";

interface VsCodeApi {
  postMessage(message: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscodeApi: VsCodeApi = acquireVsCodeApi();

export function send(message: WebviewToExtension): void {
  vscodeApi.postMessage(message);
}

export function onMessage(handler: (message: ExtensionToWebview) => void): () => void {
  const listener = (event: MessageEvent<ExtensionToWebview>) => handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
