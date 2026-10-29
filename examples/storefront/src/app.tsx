// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from "react";

import { KaitenAnonymousCheckoutClient, KaitenSessionClient } from "@kaitencloud/client";
import { KaitenStyleRoot, KaitenProvider, type KaitenAppearance } from "@kaitencloud/react-ui";

import { AccountContext, useAccount, type Account } from "./account.tsx";
import {
  fetchCustomerSession,
  loadAccount,
  loadConfig,
  signOut as signOutOfBackend,
  type AccountState,
  type StorefrontConfig,
} from "./config.ts";
import { PalettePicker } from "./components/palette-picker.tsx";
import { ThemeSwitcher } from "./components/theme-switcher.tsx";
import { CheckoutPage } from "./pages/checkout-page.tsx";
import { JourneyPage } from "./pages/journey-page.tsx";
import { PortalPage } from "./pages/portal-page.tsx";
import { PricingPage } from "./pages/pricing-page.tsx";
import { SalesPage } from "./pages/sales-page.tsx";
import { Link, useLocation } from "./router.tsx";
import { StorefrontConfigContext } from "./visitor-checkout.tsx";
import { usePalette } from "./palette.ts";
import { paletteById } from "./themes/palettes.ts";
import { toAppearance } from "./themes/to-appearance.ts";
import { useThemePreference } from "./theme.ts";

export function App() {
  const [loaded, setLoaded] = useState<
    { config: StorefrontConfig; account: AccountState } | Error | null
  >(null);

  useEffect(() => {
    Promise.all([loadConfig(), loadAccount()]).then(
      ([config, account]) => setLoaded({ config, account }),
      (error: unknown) => setLoaded(error instanceof Error ? error : new Error(String(error))),
    );
  }, []);

  if (loaded === null) return <main className="container status">Loading…</main>;
  if (loaded instanceof Error) {
    return (
      <main className="container status">
        <p role="alert">The storefront could not start: {loaded.message}</p>
      </main>
    );
  }
  return <Storefront config={loaded.config} initialAccount={loaded.account} />;
}

function Storefront({
  config,
  initialAccount,
}: {
  config: StorefrontConfig;
  initialAccount: AccountState;
}) {
  const [sessionEnded, setSessionEnded] = useState(false);
  const [theme] = useThemePreference();
  const [palette] = usePalette();
  // The colour mode, and the theme's tokens on top of it. The storefront's own look overrides nothing.
  const appearance = useMemo<KaitenAppearance>(() => {
    const themed = paletteById(palette)?.theme;
    return { baseTheme: theme, ...(themed ? toAppearance(themed) : {}) };
  }, [theme, palette]);

  const [account, setAccount] = useState(initialAccount);
  const [justSignedUp, setJustSignedUp] = useState(false);

  // The backend says the cookie's account is gone, or there never was one: a visitor again.
  const signedOut = useCallback(() => {
    setAccount((current) =>
      current.accounts === "sign-up" ? { ...current, signedIn: false } : current,
    );
  }, []);

  const newSessionClient = useCallback(
    () =>
      new KaitenSessionClient({
        apiUrl: config.apiUrl,
        getCustomerSession: () => fetchCustomerSession(signedOut),
        // The API refused a session that had just been renewed: the customer has to sign in again.
        onAuthError: () => setSessionEnded(true),
      }),
    [config.apiUrl, signedOut],
  );
  // One per customer: the provider's scope and its cache follow this object, so the customer who
  // signs up gets a client of their own.
  const [sessionClient, setSessionClient] = useState(newSessionClient);
  // The visitor's checkout has no customer to be a client of: one client, for the page, which keeps the token
  // of the checkout it started, and the provider that draws the flow is given it. A new object is a client that
  // has not the tokens the old one held, so it is made once.
  const [anonymousCheckoutClient] = useState(
    () =>
      new KaitenAnonymousCheckoutClient({
        apiUrl: config.apiUrl,
        publishableKey: config.publishableKey,
      }),
  );

  const signedUp = useCallback(() => {
    setSessionClient(newSessionClient());
    setAccount((current) => ({ ...current, signedIn: true }));
    setJustSignedUp(true);
  }, [newSessionClient]);

  const reload = useCallback(async () => {
    const next = await loadAccount().catch(() => null);
    if (next === null) return;
    if (next.accounts !== account.accounts || next.signedIn !== account.signedIn) {
      setSessionClient(newSessionClient());
      setAccount(next);
    }
  }, [account, newSessionClient]);

  const signOut = useCallback(async () => {
    await signOutOfBackend();
    // A full load: it drops the session client and every cache the last customer filled.
    window.location.assign("/");
  }, []);

  const context = useMemo<Account>(
    () => ({ ...account, justSignedUp, signedUp, signOut, reload }),
    [account, justSignedUp, signedUp, signOut, reload],
  );

  // The same Light / Dark / System as the page (see theme.ts): react-ui follows the system setting by
  // itself while it is "system". The theme is the one of palette.ts, mapped to the components'
  // appearance in one place (themes/to-appearance.ts).
  const shell = (
    <KaitenStyleRoot appearance={appearance}>
      <StorefrontConfigContext.Provider value={config}>
        <AccountContext.Provider value={context}>
          <Shell mode={config.mode} sessionEnded={sessionEnded} />
        </AccountContext.Provider>
      </StorefrontConfigContext.Provider>
    </KaitenStyleRoot>
  );

  // The portal's button for a plan change is worded "Upgrade version" by default; in V1 it is a
  // commercial request (see change-plan.ts), and the specification calls it "Change plan".
  const localization = { currentPlan: { upgradeVersion: "Change plan" } };

  // A customer's session is minted as soon as that mode mounts, on every page. A visitor who has no
  // account has nobody to mint for: the pricing table is public, read with the publishable key
  // alone, and the session starts once they have an account. The two branches render the same component
  // type at the same position, so React keeps the provider and the page is not remounted under the
  // visitor; the change of `mode` and of `sessionClient` is what moves the provider's scope, and with it
  // its cache, to the new customer.
  return account.signedIn ? (
    <KaitenProvider
      mode="customer-session"
      sessionClient={sessionClient}
      // The catalogue is read beside the portal, with the publishable key.
      apiUrl={config.apiUrl}
      publishableKey={config.publishableKey}
      localization={localization}
    >
      {shell}
    </KaitenProvider>
  ) : (
    <KaitenProvider
      mode="public"
      apiUrl={config.apiUrl}
      publishableKey={config.publishableKey}
      anonymousCheckoutClient={anonymousCheckoutClient}
      localization={localization}
    >
      {shell}
    </KaitenProvider>
  );
}

function HeaderSignOut() {
  const { signOut } = useAccount();
  const [leaving, setLeaving] = useState(false);
  return (
    <button
      type="button"
      className="site-nav-button"
      disabled={leaving}
      onClick={() => {
        setLeaving(true);
        // A failure leaves the visitor where they were, and the button to try again.
        signOut().catch(() => setLeaving(false));
      }}
    >
      Sign out
    </button>
  );
}

function Shell({ mode, sessionEnded }: { mode: StorefrontConfig["mode"]; sessionEnded: boolean }) {
  const { path } = useLocation();
  const account = useAccount();
  const page = path.startsWith("/checkout/")
    ? "checkout"
    : path === "/portal"
      ? "portal"
      : path === "/journey"
        ? "journey"
        : path === "/sales"
          ? "sales"
          : "pricing";

  return (
    <div className="site">
      <header className="site-header">
        <div className="container site-header-inner">
          <Link to="/" className="brand" aria-label="Acme, home">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            <span className="brand-name">Acme</span>
          </Link>
          <nav aria-label="Pages" className="site-nav">
            <Link
              to="/"
              aria-current={page === "pricing" || page === "checkout" ? "page" : undefined}
            >
              Pricing
            </Link>
            <Link to="/portal" aria-current={page === "portal" ? "page" : undefined}>
              Account
            </Link>
            <Link to="/journey" aria-current={page === "journey" ? "page" : undefined}>
              Journey
            </Link>
            {/* Whoever made an account here can leave it from any page: a demo starts over from the home page.
                The Account page has its own button, beside the customer's name. */}
            {account.accounts === "sign-up" && account.signedIn && page !== "portal" ? (
              <HeaderSignOut />
            ) : null}
          </nav>
          <div className="site-controls">
            <PalettePicker />
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      {sessionEnded ? (
        <div className="container">
          <p className="notice error" role="alert">
            Your session has ended. Reload the page to sign in again.
          </p>
        </div>
      ) : null}

      <main className="container site-main">
        {page === "checkout" ? (
          <CheckoutPage slug={decodeURIComponent(path.slice("/checkout/".length))} />
        ) : page === "portal" ? (
          <PortalPage />
        ) : page === "journey" ? (
          <JourneyPage mode={mode} />
        ) : page === "sales" ? (
          <SalesPage />
        ) : (
          <PricingPage />
        )}
      </main>

      <footer className="site-footer">
        <div className="container site-footer-inner">
          <span>&copy; Acme, an example shop built on Kaiten billing.</span>
          {mode === "double" ? (
            <span data-testid="double-notice">Stand-in for Kaiten: no payment is real.</span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
