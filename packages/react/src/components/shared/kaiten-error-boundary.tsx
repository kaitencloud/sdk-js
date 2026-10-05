import * as React from "react";

import { useLocalization } from "../../localization/context.tsx";

export interface KaitenErrorBoundaryProps {
  /**
   * Custom fallback. The function form receives the caught `error` and a `reset`
   * callback that clears the error and re-renders the children — wire it to a
   * "try again" control.
   */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /**
   * When any value in this array changes (shallow compare), the boundary clears
   * its error and retries — so a transient failure (a flaky fetch, a route or
   * customer change) recovers instead of permanently bricking the subtree.
   */
  resetKeys?: ReadonlyArray<unknown>;
  children: React.ReactNode;
}

interface KaitenErrorBoundaryState {
  error: Error | null;
}

function resetKeysChanged(
  prev: ReadonlyArray<unknown> | undefined,
  next: ReadonlyArray<unknown> | undefined,
): boolean {
  if (prev === next) return false;
  if (!prev || !next || prev.length !== next.length) return true;
  return prev.some((value, index) => !Object.is(value, next[index]));
}

/**
 * Localized default fallback. The technical `error.message` is intentionally NOT
 * shown to the user (it is English, server-detailed, and unlocalized) — it is
 * delivered to `onError` for logging/telemetry instead. Uses `useLocalization`,
 * which has a default value, so it renders correctly even outside a provider.
 *
 * The one place this package names a class. They are inert without
 * `@kaitencloud/react-ui/styles.css`, and deliberately so: the markup is
 * semantic on its own (an `alert` and a button), a host that draws gets the
 * styling from the stylesheet it already imports, and `fallback` is there for
 * anyone who wants neither.
 */
function DefaultErrorFallback({ onRetry }: { onRetry: () => void }) {
  const localization = useLocalization();

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-ktn-lg border border-ktn-destructive/30 bg-ktn-destructive/10 p-4 text-sm text-ktn-destructive"
    >
      <span>{localization.states.failed}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-ktn-md border border-ktn-destructive/30 px-2 py-1 text-xs font-medium"
      >
        {localization.states.retry}
      </button>
    </div>
  );
}

export class KaitenErrorBoundary extends React.Component<
  KaitenErrorBoundaryProps,
  KaitenErrorBoundaryState
> {
  public state: KaitenErrorBoundaryState = {
    error: null,
  };

  public static getDerivedStateFromError(error: Error): KaitenErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  public componentDidUpdate(prevProps: KaitenErrorBoundaryProps): void {
    if (this.state.error && resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  public render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (typeof this.props.fallback === "function") {
      return this.props.fallback(this.state.error, this.reset);
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return <DefaultErrorFallback onRetry={this.reset} />;
  }
}
