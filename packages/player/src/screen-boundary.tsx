// A screen that throws while it draws (a field the lean reader let through that a view cannot read) is drawn as nothing, and the deck goes on: the viewer can move to
// the next screen (NFR-REL-002; ADR-0026 amendment, M11.42). The boundary is keyed by the screen, so the next screen gets a fresh one.
import { Component, type ReactNode } from 'react';

/**
 * Props of {@link ScreenBoundary}.
 */
type ScreenBoundaryProps = {
  /** What to draw. */
  readonly children: ReactNode;
  /** Told when a screen threw (the error), so a host can log it; the boundary draws nothing in its place. */
  readonly onError?: (error: unknown) => void;
};

/**
 * The state of a {@link ScreenBoundary}.
 */
type ScreenBoundaryState = {
  /** Whether the children threw. */
  readonly failed: boolean;
};

/**
 * Draws its children, or nothing when they throw.
 */
export class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  /** Whether the children threw. */
  override state: ScreenBoundaryState = { failed: false };

  /** React's hook: a throw below marks the boundary failed. */
  static getDerivedStateFromError(): ScreenBoundaryState {
    return { failed: true };
  }

  /** React's hook: tells the host. */
  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  /** The children, or nothing once they threw. */
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
