// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The trial banner of a customer session, on the real session client and the portal Kaiten recorded
// for Initech, put in its trial with the block the contract gives (`trialPortal`; the client maps
// it). What is held: the countdown to the end,
// the server's figure for what the end charges and the card it goes to, "Add a card" through the
// provider's page and back, "Cancel" with the question first, and nothing at all outside a trial.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { de, es, fr } from "@kaitencloud/react/locales";

import { TrialBanner, formatKaitenDate } from "../src/index.ts";
import { sessionServer, trialPortal } from "../.storybook/session-server.ts";
import { mount, press, flat } from "./support/session-mount.tsx";
import { KaitenProvider } from "./support/styled-provider.tsx";

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  window.sessionStorage.clear();
  at("/billing");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Five days and four hours before the trial of `trialPortal` ends. */
const FIVE_DAYS_LEFT = "2026-10-25T05:00:00Z";
const ENDS_ON = formatKaitenDate("2026-10-30T09:00:00Z");

const banner = (props: Parameters<typeof TrialBanner>[0] = {}) => (
  <TrialBanner now={FIVE_DAYS_LEFT} {...props} />
);

describe("what it says", () => {
  test("counts down to the end, says the date, and what the end charges, the server's figure", async () => {
    mount(sessionServer({ portal: trialPortal() }), banner());

    expect(await screen.findByText("Your trial ends in 5 days")).toBeTruthy();
    expect(screen.getByText(`Ends on ${ENDS_ON}`)).toBeTruthy();
    expect(flat(screen.getByText(/will be charged on/).textContent)).toBe(
      `€49.00/month will be charged on ${ENDS_ON}.`,
    );
    expect(screen.getByRole("region", { name: "Free trial" })).toBeTruthy();
  });

  test("counts in the unit that is left: days, hours, minutes, a moment", async () => {
    for (const [now, said] of [
      ["2026-10-29T07:00:00Z", "Your trial ends in 1 day"],
      ["2026-10-30T06:30:00Z", "Your trial ends in 2 hours"],
      ["2026-10-30T08:59:00Z", "Your trial ends in 1 minute"],
      ["2026-10-30T08:45:00Z", "Your trial ends in 15 minutes"],
      ["2026-10-30T09:00:00Z", "Your trial ends in a moment"],
      ["2026-11-02T09:00:00Z", "Your trial ends in a moment"],
    ] as const) {
      mount(sessionServer({ portal: trialPortal() }), banner({ now }));
      expect(await screen.findByText(said), now).toBeTruthy();
      cleanup();
    }
  });

  test("a quarter is written as a quarter", async () => {
    mount(
      sessionServer({
        portal: trialPortal({
          charge: { amount: 13500, currency: "EUR", billingPeriod: "QUARTERLY" },
        }),
      }),
      banner(),
    );
    expect(flat((await screen.findByText(/will be charged on/)).textContent)).toContain(
      "€135.00 every 3 months",
    );
  });

  test("says nothing will be charged when the end charges nothing", async () => {
    mount(sessionServer({ portal: trialPortal({ charge: null }) }), banner());

    expect(await screen.findByText("Nothing will be charged when your trial ends.")).toBeTruthy();
    expect(screen.queryByText(/will be charged on/)).toBeNull();
  });

  test("says the card, by its brand and its last four digits, and never a number", async () => {
    mount(
      sessionServer({ portal: trialPortal({ paymentMethod: { brand: "visa", last4: "4242" } }) }),
      banner(),
    );

    expect(await screen.findByText("Card on file: Visa •••• 4242.")).toBeTruthy();
    expect(screen.queryByText(/No card on file/)).toBeNull();
    // A card on file is not asked for again.
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
  });

  test("says a card whose labels the provider did not give as a card, not as a blank", async () => {
    mount(
      sessionServer({ portal: trialPortal({ paymentMethod: { brand: null, last4: null } }) }),
      banner(),
    );

    expect(await screen.findByText("Card on file: Card.")).toBeTruthy();
  });

  test("asks for a card when there is none, since the end of the trial may depend on it", async () => {
    mount(sessionServer({ portal: trialPortal() }), banner());

    expect(
      await screen.findByText("No card on file yet. Add one before your trial ends."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a card" })).toBeTruthy();
  });

  test("ticks: a clock that moves moves the countdown", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
    mount(sessionServer({ portal: trialPortal() }), <TrialBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(await screen.findByText("Your trial ends in 23 hours")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(screen.getByText("Your trial ends in 22 hours")).toBeTruthy();
  });

  test("says it in French, Spanish and German", async () => {
    for (const [locale, countdown, ends, card] of [
      [fr, "Votre essai se termine dans 5 jours", "Se termine le", "Ajouter une carte"],
      [es, "Su prueba termina en 5 días", "Termina el", "Añadir una tarjeta"],
      [de, "Ihre Testphase endet in 5 Tagen", "Endet am", "Karte hinzufügen"],
    ] as const) {
      mount(sessionServer({ portal: trialPortal() }), banner(), locale);
      expect(await screen.findByText(countdown)).toBeTruthy();
      expect(screen.getByText(new RegExp(`^${ends} `))).toBeTruthy();
      expect(screen.getByRole("button", { name: card })).toBeTruthy();
      cleanup();
    }
  });
});

describe("when it is not there", () => {
  test("outside a trial the portal has no block, and nothing is drawn", async () => {
    const server = sessionServer();
    const { container } = mount(server, banner());
    await vi.waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  test("a block that is null draws nothing either", async () => {
    const server = sessionServer({ portal: trialPortal({}, (portal) => (portal.trial = null)) });
    const { container } = mount(server, banner());
    await vi.waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  test("a server that does not serve the block draws nothing", async () => {
    const server = sessionServer({
      portal: trialPortal({}, (portal) => {
        delete portal.trial;
      }),
    });
    const { container } = mount(server, banner());
    await vi.waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  test("nor while the portal is being read", () => {
    const { container } = mount(sessionServer({ portal: trialPortal() }), banner());
    expect(container.textContent).toBe("");
  });

  test("a trial the host holds is drawn from the prop, and null from the prop draws nothing", async () => {
    const server = sessionServer();
    mount(
      server,
      banner({
        trial: {
          endsAt: "2026-10-30T09:00:00Z",
          reminderAt: "2026-10-27T09:00:00Z",
          charge: { amount: 4900, currencyCode: "EUR", billingInterval: "month" },
          paymentMethod: null,
        },
      }),
    );
    expect(await screen.findByText("Your trial ends in 5 days")).toBeTruthy();
    cleanup();

    const { container } = mount(sessionServer(), banner({ trial: null }));
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  test("nor under any other mode", () => {
    const { container } = render(
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        {banner()}
      </KaitenProvider>,
    );
    expect(container.textContent).toBe("");
  });

  test("offers only what the portal lets this customer do", async () => {
    const server = sessionServer({
      portal: trialPortal({}, (portal) => {
        portal.capabilities.paymentMethods = false;
        portal.capabilities.unsubscribe = false;
      }),
    });
    mount(server, banner());
    await screen.findByText("Your trial ends in 5 days");

    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    // The prompt to add one stays: it is what the portal says about the trial, not an action.
    expect(screen.getByText(/No card on file yet/)).toBeTruthy();
  });
});

describe("Add a card", () => {
  test("sends the customer to the provider's page and back to this one", async () => {
    at("/billing?tab=trial&kaiten_x=1#top");
    const navigate = vi.fn();
    const server = sessionServer({ portal: trialPortal() });
    mount(server, banner({ navigate }));
    await press("Add a card");

    const [call] = server.to("POST", "billing/payment-method-session");
    expect(call!.body).toMatchObject({ returnUrl: `${window.location.origin}/billing?tab=trial` });
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://checkout.stripe.test/c/setup_2");
  });

  test("confirms the card when the customer is back, reads the portal again and shows it", async () => {
    const server = sessionServer({ portal: trialPortal() });
    mount(server, banner({ navigate: vi.fn() }));
    await press("Add a card");
    cleanup();

    at("/billing?kaiten_setup_session=cs_setup_2");
    mount(server, banner({ navigate: vi.fn() }));

    expect(await screen.findByText("Card on file: Visa •••• 4242.")).toBeTruthy();
    expect(server.to("POST", "billing/payment-method-session/cs_setup_2/complete")).toHaveLength(1);
    expect(screen.getByText("Card saved.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("a page the customer did not finish is said, with the way to add one again", async () => {
    const server = sessionServer({ portal: trialPortal() });
    server.script("POST billing/payment-method-session/*/complete", {
      status: 409,
      body: {
        title: "Conflict",
        status: 409,
        detail: "no payment method was saved on that page",
        code: "CompleteSessionPaymentMethodSession.SessionNotComplete",
      },
    });
    mount(server, banner({ navigate: vi.fn() }));
    await press("Add a card");
    cleanup();
    at("/billing?kaiten_setup_session=cs_setup_2");
    mount(server, banner({ navigate: vi.fn() }));

    expect(
      await screen.findByText("We haven't received a card yet. Add one, or check again."),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a card" })).toBeTruthy();
  });
});

describe("Cancel", () => {
  test("asks first, and says the trial ends at once with nothing charged; keeping it sends nothing", async () => {
    const server = sessionServer({ portal: trialPortal() });
    mount(server, banner());
    await press("Cancel");

    expect(screen.getByText("Your trial will end now, and you won't be charged.")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(
      "Your trial will end now, and you won't be charged.",
    );
    await press("Keep my trial");
    expect(server.to("POST", "billing/cancel")).toHaveLength(0);
    expect(screen.queryByText(/Your trial will end now/)).toBeNull();
    // Back on the control that opened the question.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
  });

  test("ends the trial: the portal is read again, the banner is gone, the host is told", async () => {
    const onTrialEnded = vi.fn();
    const server = sessionServer({ portal: trialPortal() });
    const { container } = mount(server, banner({ onTrialEnded }));
    await press("Cancel");
    await press("End my trial");

    expect(server.to("POST", "billing/cancel")).toHaveLength(1);
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(onTrialEnded).toHaveBeenCalledTimes(1);
  });

  test("a refusal is said, and the question stays", async () => {
    const server = sessionServer({ portal: trialPortal() });
    server.script("POST billing/cancel", {
      status: 500,
      body: { title: "Boom", status: 500 },
    });
    mount(server, banner());
    await press("Cancel");
    await press("End my trial");

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Your trial will end now, and you won't be charged.")).toBeTruthy();
  });
});

describe("unstyled", () => {
  test("is plain markup with the slots to target, and the same words", async () => {
    mount(sessionServer({ portal: trialPortal() }), banner({ unstyled: true }));
    const region = await screen.findByRole("region", { name: "Free trial" });

    expect(region.getAttribute("data-slot")).toBe("trial-banner");
    expect(region.querySelector('[data-slot="trial-banner-countdown"]')?.textContent).toBe(
      "Your trial ends in 5 days",
    );
    expect(region.querySelector('[data-slot="trial-banner-card"]')?.textContent).toMatch(/No card/);
    expect(region.querySelector('[data-slot="card"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("group", { name: "Cancel" })).toBeTruthy();
  });
});
