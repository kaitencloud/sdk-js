// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

export interface KaitenTelemetryEvent {
  type: "component" | "hook" | "action";
  name: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface KaitenTelemetryOptions {
  disabled?: boolean;
  transport?: (event: KaitenTelemetryEvent) => void | Promise<void>;
  /**
   * Honor the browser's Do-Not-Track / Global Privacy Control signal — when the
   * user opted out, no events are sent. Defaults to `true`.
   */
  respectDoNotTrack?: boolean;
  /**
   * Per-event consent gate. Return `false` to drop the event (runs after the
   * DNT check, before sampling). Use for cookie-consent / allow-lists.
   */
  shouldTrack?: (event: KaitenTelemetryEvent) => boolean;
  /**
   * Sampling rate in `[0, 1]` for high-frequency `action` events (`1` = all,
   * the default; `0` = none). Component/hook usage pings are deduped already
   * and never sampled.
   */
  sampleRate?: number;
}
