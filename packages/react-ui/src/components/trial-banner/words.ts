// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { formatKaitenDate, useLocalization, type KaitenTrialBannerWords } from "@kaitencloud/react";

/**
 * The English words of the trial banner. They live here and not in the core's defaults because only
 * this component says them: a host that draws no banner carries none of them. A language pack
 * carries its own set, whole (`@kaitencloud/react/locales`), and a host's override of one string is
 * merged over these.
 */
export const englishTrialBannerWords: KaitenTrialBannerWords = {
  title: "Free trial",
  endsInDays: (days) => `Your trial ends in ${days} ${days === 1 ? "day" : "days"}`,
  endsInHours: (hours) => `Your trial ends in ${hours} ${hours === 1 ? "hour" : "hours"}`,
  endsInMinutes: (minutes) =>
    `Your trial ends in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
  endsInAMoment: "Your trial ends in a moment",
  endsOn: (isoDate) => `Ends on ${formatKaitenDate(isoDate)}`,
  chargeOn: (price, isoDate) => `${price} will be charged on ${formatKaitenDate(isoDate)}.`,
  chargeWouldOn: (price, isoDate) => `${price} would be charged on ${formatKaitenDate(isoDate)}.`,
  nothingCharged: "Nothing will be charged when your trial ends.",
  cardOnFile: (label) => `Card on file: ${label}.`,
  noCard: "No card on file yet. Add one before your trial ends.",
  card: "Card",
  addCard: "Add a card",
  cancel: "Cancel",
  cancelPrompt: "Your trial will end now, and you won't be charged.",
  cancelConfirm: "End my trial",
  cancelKeep: "Keep my trial",
  opening: "Opening…",
  saving: "Saving your card…",
  saved: "Card saved.",
  incomplete: "We haven't received a card yet. Add one, or check again.",
  unavailable: "The payment provider can't be reached right now. Try again in a moment.",
  stillClosing: "Your billing period is still being closed. Try again in a minute.",
  error: "Something went wrong. Please try again.",
};

/** The words of the trial banner: the language's, and the host's own over them, over the English ones. */
export function useTrialBannerWords(): KaitenTrialBannerWords {
  const { trialBanner } = useLocalization();
  return React.useMemo(() => ({ ...englishTrialBannerWords, ...trialBanner }), [trialBanner]);
}
