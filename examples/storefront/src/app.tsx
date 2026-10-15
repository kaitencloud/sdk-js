import { useEffect, useState } from "react";

import { KaitenSessionClient } from "@kaitencloud/client";
import { KaitenStyleRoot, KaitenProvider } from "@kaitencloud/react-ui";

import { fetchCustomerSession, loadConfig, type StorefrontConfig } from "./config.ts";
import { ThemeSwitcher } from "./components/theme-switcher.tsx";
import { CheckoutPage } from "./pages/checkout-page.tsx";
import { JourneyPage } from "./pages/journey-page.tsx";
import { PortalPage } from "./pages/portal-page.tsx";
import { PricingPage } from "./pages/pricing-page.tsx";
import { SalesPage } from "./pages/sales-page.tsx";
import { Link, useLocation } from "./router.tsx";
import { useThemePreference } from "./theme.ts";

export function App() {
  const [config, setConfig] = useState<StorefrontConfig | Error | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig, (error: unknown) =>
      setConfig(error instanceof Error ? error : new Error(String(error))),
    );
  }, []);

  if (config === null) return <main className="container status">Loading…</main>;
  if (config instanceof Error) {
    return (
      <main className="container status">
        <p role="alert">The storefront could not start: {config.message}</p>
      </main>
    );
  }
  return <Storefront config={config} />;
}

function Storefront({ config }: { config: StorefrontConfig }) {
  const [sessionEnded, setSessionEnded] = useState(false);
  const [theme] = useThemePreference();

  // Once: the provider's scope and its cache follow this object.
  const [sessionClient] = useState(
    () =>
      new KaitenSessionClient({
        apiUrl: config.apiUrl,
        getCustomerSession: fetchCustomerSession,
        // The API refused a session that had just been renewed: the customer has to sign in again.
        onAuthError: () => setSessionEnded(true),
      }),
  );

  return (
    <KaitenProvider
      mode="customer-session"
      sessionClient={sessionClient}
      // The catalogue is read beside the portal, with the publishable key.
      apiUrl={config.apiUrl}
      publishableKey={config.publishableKey}
      // The portal's button for a plan change is worded "Upgrade version" by default; in V1 it is a
      // commercial request (see change-plan.ts), and the specification calls it "Change plan".
      localization={{ currentPlan: { upgradeVersion: "Change plan" } }}
    >
      {/* The same Light / Dark / System as the page (see theme.ts): react-ui follows the system
          setting by itself while it is "system". */}
      <KaitenStyleRoot appearance={{ baseTheme: theme }}>
        <Shell mode={config.mode} sessionEnded={sessionEnded} />
      </KaitenStyleRoot>
    </KaitenProvider>
  );
}

function Shell({ mode, sessionEnded }: { mode: StorefrontConfig["mode"]; sessionEnded: boolean }) {
  const { path } = useLocation();
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
            <span>Acme</span>
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
          </nav>
          <ThemeSwitcher />
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
