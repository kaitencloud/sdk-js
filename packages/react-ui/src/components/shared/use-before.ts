// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

/** True until `until` (milliseconds since the epoch) has passed, and re-renders when it does. */
export function useBefore(until: number | null): boolean {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (until === null || until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), until - now);
    return () => clearTimeout(timer);
  }, [until, now]);
  return until !== null && until > now;
}
