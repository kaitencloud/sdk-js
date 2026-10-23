// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useLocalization } from "@kaitencloud/react";

// The one sentence every link that opens a tab of its own carries, read after the link's name. It has
// a module of its own so that the shared messages and actions import this line and not a screen's
// whole dictionary: the checkout's English words are about 1.3 KB gzipped, and a card that draws no
// checkout would ship them for the sake of one phrase.
//
// A language pack and a host still set it where they always did, in the checkout's words
// (`checkoutFlow.opensInNewTab`).

const ENGLISH_OPENS_IN_NEW_TAB = "opens in a new tab";

/** What a link to another page, in a tab of its own, says besides its name. */
export function useOpensInNewTab(): string {
  return useLocalization().checkoutFlow?.opensInNewTab ?? ENGLISH_OPENS_IN_NEW_TAB;
}
