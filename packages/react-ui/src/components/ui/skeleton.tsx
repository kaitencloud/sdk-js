// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { cn } from "../../lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("ktn-own", "bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
