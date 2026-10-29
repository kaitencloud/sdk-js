// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useEffect } from "react";

/**
 * Names the page in the tab and to a screen reader: the router changes the page without loading
 * another document, so the title would otherwise stay the one the first page was loaded with.
 */
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} · Acme`;
  }, [page]);
}
