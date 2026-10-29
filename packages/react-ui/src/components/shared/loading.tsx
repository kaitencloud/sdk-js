// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from "../ui/skeleton.tsx";

export function CardLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-32" />
      <div className="mt-2 flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

export function InlineLoading() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="size-4 rounded-full" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}
