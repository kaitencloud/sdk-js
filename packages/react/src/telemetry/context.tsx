// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import type { KaitenTelemetryEvent, KaitenTelemetryOptions } from "./types.ts";

interface TelemetryContextValue {
  track: (event: Omit<KaitenTelemetryEvent, "timestamp">, onceKey?: string) => void;
}

const TelemetryContext = /* @__PURE__ */ React.createContext<TelemetryContextValue>({
  track: () => {},
});

/** True when the user enabled Do-Not-Track or Global Privacy Control. */
function doNotTrackEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt = nav.doNotTrack ?? nav.msDoNotTrack;
  return dnt === "1" || dnt === "yes" || nav.globalPrivacyControl === true;
}

export interface TelemetryProviderProps {
  telemetry?: KaitenTelemetryOptions;
  children: React.ReactNode;
}

export function TelemetryProvider({ telemetry, children }: TelemetryProviderProps) {
  const seen = React.useRef(new Set<string>());

  const value = React.useMemo<TelemetryContextValue>(
    () => ({
      track: (event, onceKey) => {
        if (telemetry?.disabled || !telemetry?.transport) return;
        if (onceKey && seen.current.has(onceKey)) return;

        // Privacy gates: honor DNT/GPC by default, then a consent predicate.
        if ((telemetry.respectDoNotTrack ?? true) && doNotTrackEnabled()) return;

        const fullEvent: KaitenTelemetryEvent = { ...event, timestamp: new Date().toISOString() };
        if (telemetry.shouldTrack && !telemetry.shouldTrack(fullEvent)) return;

        // Sampling: only high-frequency `action` events (usage pings are deduped
        // via onceKey). `sampleRate` 1/undefined = send all, 0 = send none.
        if (event.type === "action" && typeof telemetry.sampleRate === "number") {
          if (telemetry.sampleRate <= 0 || Math.random() > telemetry.sampleRate) return;
        }

        if (onceKey) seen.current.add(onceKey);
        void telemetry.transport(fullEvent);
      },
    }),
    [telemetry],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry() {
  return React.useContext(TelemetryContext);
}

export function useTrackComponent(componentName: string): void {
  const telemetry = useTelemetry();

  React.useEffect(() => {
    telemetry.track({ type: "component", name: componentName }, `component:${componentName}`);
  }, [componentName, telemetry]);
}

export function useTrackHook(hookName: string): void {
  const telemetry = useTelemetry();

  React.useEffect(() => {
    telemetry.track({ type: "hook", name: hookName }, `hook:${hookName}`);
  }, [hookName, telemetry]);
}
