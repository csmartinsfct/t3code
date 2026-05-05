// Shared types for the overlay renderer components.

export interface OverlayBridgeHandle {
  emitEvent(type: string, payload: unknown): void;
  requestDismiss(): void;
}
