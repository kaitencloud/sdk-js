import { useEffect, useState } from "react";

import { KaitenSessionClient } from "@kaitencloud/client";
import { KaitenStyleRoot, KaitenProvider } from "@kaitencloud/react-ui";

import { fetchCustomerSession, loadConfig, type StorefrontConfig } from "./config.ts";
import { CheckoutPage } from "./pages/checkout-page.tsx";
import { PortalPage } from "./pages/portal-page.tsx";
import { PricingPage } from "./pages/pricing-page.tsx";
import { Link, useLocation } from "./router.tsx";

export function App() {
  const [config, setConfig] = useState<StorefrontConfig | Error | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig, (error: unknown) =>
      setConfig(error instanceof Error ? error : new Error(String(error))),
    );
  }, []);

  if (config === null) return <main className="shell">Loading…</main>;
  if (config instanceof Error) {
    return (
      <main className="shell">
        <p role="alert">The storefront could not start: {config.message}</p>
      </main>
    );
  }
  return <Storefront config={config} />;
}

function Storefront({ config }: { config: StorefrontConfig }) {
  const [sessionEnded, setSessionEnded] = useState(false);

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
    >
      <KaitenStyleRoot>
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
      : "pricing";

  return (
    <div className="shell">
      <header>
        <strong>Acme storefront</strong>
        <nav aria-label="Pages">
          <Link to="/" aria-current={page === "pricing" ? "page" : undefined}>
            Pricing
          </Link>
          <Link to="/portal" aria-current={page === "portal" ? "page" : undefined}>
            Your account
          </Link>
        </nav>
      </header>

      {mode === "double" ? (
        <p className="notice" data-testid="double-notice">
          This storefront runs against a stand-in for Kaiten: no payment is real.
        </p>
      ) : null}
      {sessionEnded ? (
        <p className="notice error" role="alert">
          Your session has ended. Reload the page to sign in again.
        </p>
      ) : null}

      <main>
        {page === "checkout" ? (
          <CheckoutPage slug={decodeURIComponent(path.slice("/checkout/".length))} />
        ) : page === "portal" ? (
          <PortalPage />
        ) : (
          <PricingPage />
        )}
      </main>
    </div>
  );
}
