// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Who the visitor is, for the pages: a customer the storefront signs in by itself, a visitor who has
// not made an account yet, or a customer who made one here. `app.tsx` owns the state; the pages read it.

import { createContext, useContext, useEffect } from "react";

export interface Account {
  /** `fixed`: one customer, every visitor is signed in as it. `sign-up`: a visitor makes an account. */
  accounts: "fixed" | "sign-up";
  /** Whether there is a customer to act for. Always so with `fixed` accounts. */
  signedIn: boolean;
  /** The visitor made their account a moment ago, on this page. */
  justSignedUp: boolean;
  /** The backend made the visitor an account: the page now acts for it. */
  signedUp: () => void;
  /** Forgets the account and starts over on the home page, as a new visitor. */
  signOut: () => Promise<void>;
  /**
   * Asks the backend again who the visitor is. The journey page needs it: it starts the stand-in over as
   * a visitor, or as the customer it has by default, under the feet of a page that was told otherwise.
   */
  reload: () => Promise<void>;
}

export const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount needs the storefront's AccountContext.");
  return account;
}

/**
 * Puts the keyboard where the visitor now is, once their sign-up has replaced the form they were in
 * with the page they came for: the form is gone, and the focus with it.
 */
export function useTitleFocusAfterSignUp(ready: boolean): void {
  const { justSignedUp } = useAccount();
  useEffect(() => {
    if (!justSignedUp || !ready) return;
    const title = document.querySelector<HTMLElement>("main h1");
    if (!title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }, [justSignedUp, ready]);
}
