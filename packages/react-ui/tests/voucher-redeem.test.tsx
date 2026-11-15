// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// A code entered in the portal of a customer whose subscription is live: what it gives is shown first
// (a dry run, nothing is redeemed), and the customer applies it or leaves it. The session is the
// real client on the recorded portal of Initech, and the redemption route answers as the contract
// gives it (`.storybook/session-server.ts`).

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import { VoucherEntry } from "../src/index.ts";
import { refusal, sessionServer, trialPortal } from "../.storybook/session-server.ts";
import { FAKE_TIMERS, settle } from "./support/checkout.tsx";
import { mount, off, press } from "./support/session-mount.tsx";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Types a code and presses Check. */
async function check(code: string, label = "Voucher code", button = "Check") {
  await screen.findByLabelText(label);
  type(label, code);
  await press(button);
}

describe("a live subscription", () => {
  test("a code is checked with a dry run, shows what it gives, and nothing is redeemed before Apply", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);

    await check("fiveoff");

    expect(
      await screen.findByText("Five off — Applies from your next invoice. For one invoice."),
    ).toBeTruthy();
    const [dry] = server.to("POST", "vouchers/redeem");
    expect(dry!.body).toEqual({ code: "fiveoff", dryRun: true });
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(1);
    // The field is gone for the question, and so is the code.
    expect(screen.queryByLabelText("Voucher code")).toBeNull();
    expect(document.body.innerHTML).not.toContain("fiveoff");
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  test("Apply redeems it, the portal is read again, and the redemption is listed", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);
    await check("LAUNCHBOOST");
    await screen.findByText(/Launch boost — Takes effect now\./);

    await press("Apply");

    expect(
      await screen.findByText("Launch boost applied. Takes effect now. Until Nov 6, 2026."),
    ).toBeTruthy();
    const calls = server.to("POST", "vouchers/redeem");
    expect(calls.map((call) => call.body)).toEqual([
      { code: "LAUNCHBOOST", dryRun: true },
      { code: "LAUNCHBOOST" },
    ]);
    // The portal says it is in force.
    const list = document.querySelector('[data-slot="voucher-active"]')!;
    expect(list.textContent).toContain("Launch boost");
    // And the field is back, empty, for another.
    expect((screen.getByLabelText("Voucher code") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain("LAUNCHBOOST");
  });

  test("Not now sends nothing more and gives the field back", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);
    await check("FIVEOFF");
    await press("Not now");

    expect(server.to("POST", "vouchers/redeem")).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Voucher code")));
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    // Nothing was applied: the list is what the portal had.
    expect(document.querySelector('[data-slot="voucher-active"]')!.textContent).not.toContain(
      "Five off",
    );
  });

  test("the keyboard goes to Apply when the check shows what the code gives", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);
    await check("FIVEOFF");

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" })),
    );
  });

  test("a code the portal already holds is refused like every other: it says no reason", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);

    await check("WELCOME20");

    expect(await screen.findByText("This code can't be used.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("This code can't be used.");
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  test("Enter checks the code, and nothing is sent for an empty field", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);
    await screen.findByLabelText("Voucher code");
    expect(off(screen.getByRole("button", { name: "Check" }))).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Voucher code"), { key: "Enter" });
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(0);

    type("Voucher code", "five off");
    fireEvent.keyDown(screen.getByLabelText("Voucher code"), { key: "Enter" });

    expect(await screen.findByText(/Five off — /)).toBeTruthy();
  });

  test("a check refused for coming too often says when to come back, and waits that long", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const server = sessionServer();
    server.script("POST vouchers/redeem", refusal("redeemRateLimited"));
    mount(server, <VoucherEntry />);
    await settle();

    type("Voucher code", "ONE");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await settle();
    expect(screen.getByText("Too many attempts. Try again in 2 minutes.")).toBeTruthy();

    type("Voucher code", "TWO");
    expect(off(screen.getByRole("button", { name: "Check" }))).toBe(true);
    await settle(91_000);
    expect(off(screen.getByRole("button", { name: "Check" }))).toBe(false);
  });

  test("a subscription that ended meanwhile is said, not guessed at", async () => {
    const server = sessionServer();
    server.script("POST vouchers/redeem", refusal("redeemNoLiveSubscription"));
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByText("There is no subscription to apply a code to.")).toBeTruthy();
  });

  test("a checkout that began meanwhile is said as the plan not having started", async () => {
    const server = sessionServer();
    server.script("POST vouchers/redeem", refusal("redeemSubscriptionIncomplete"));
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(
      await screen.findByText(
        "Your plan starts once your payment is confirmed. You can add a code after that.",
      ),
    ).toBeTruthy();
  });

  test("a refusal that names no instance is read as there being no subscription", async () => {
    // A mapping test: the entry never reaches a live portal without an instance, but a refusal that
    // says so is still said in the entry's words.
    const server = sessionServer();
    server.script("POST vouchers/redeem", refusal("redeemInstanceRequired"));
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByText("There is no subscription to apply a code to.")).toBeTruthy();
  });

  test("a session bound to the customer alone checks a code and has none to redeem", async () => {
    const server = sessionServer({ portal: "portalCustomerWide" });
    expect(server.portal().instance).toBeNull();
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    await waitFor(() => expect(server.to("POST", "vouchers/validate")).toHaveLength(1));
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  test("a code refused for coming too often when it is applied is gone, and the wait is kept", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const server = sessionServer();
    mount(server, <VoucherEntry />);
    await settle();
    type("Voucher code", "FIVEOFF");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await settle();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    server.script("POST vouchers/redeem", refusal("redeemRateLimited"));

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await settle();

    expect(screen.getByText("Too many attempts. Try again in 2 minutes.")).toBeTruthy();
    // The code is not kept for a second try: the field is back, empty, and waits.
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect((screen.getByLabelText("Voucher code") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain("FIVEOFF");
    type("Voucher code", "FIVEOFF");
    expect(off(screen.getByRole("button", { name: "Check" }))).toBe(true);
    expect(server.to("POST", "vouchers/redeem").map((call) => call.body)).toEqual([
      { code: "FIVEOFF", dryRun: true },
      { code: "FIVEOFF" },
    ]);
    await settle(121_000);
    expect(off(screen.getByRole("button", { name: "Check" }))).toBe(false);
  });

  test("a code refused when it is applied is refused like any other, and nothing is listed", async () => {
    const server = sessionServer();
    mount(server, <VoucherEntry />);
    await check("FIVEOFF");
    await screen.findByRole("button", { name: "Apply" });
    server.script("POST vouchers/redeem", refusal("redeemVoucherInvalid"));

    await press("Apply");

    expect(await screen.findByText("This code can't be used.")).toBeTruthy();
    expect(document.querySelector('[data-slot="voucher-active"]')?.textContent ?? "").not.toContain(
      "Five off",
    );
  });

  test("a failure that is not a refusal is said in plain words", async () => {
    const server = sessionServer();
    server.script("POST vouchers/redeem", { status: 500, body: { title: "Boom", status: 500 } });
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByText("That didn't work. Please try again.")).toBeTruthy();
  });

  test("the redemptions in force are listed with what they do, never with a code", async () => {
    const server = sessionServer({
      portal: trialPortal({}, (portal) => {
        portal.vouchers = [
          {
            name: "Welcome 20%",
            voucherType: "PRICE",
            status: "ACTIVE",
            appliesFromInvoice: "next",
            applicationsCount: 0,
            applicationsMax: 3,
            effectiveStartsAt: "2026-10-01T00:00:00Z",
            effectiveExpiresAt: null,
          },
          {
            name: "Early bird",
            voucherType: "PRICE",
            status: "ACTIVE",
            appliesFromInvoice: null,
            applicationsCount: 1,
            applicationsMax: 3,
            effectiveStartsAt: "2026-09-01T00:00:00Z",
            effectiveExpiresAt: null,
          },
          {
            name: "Flag grant",
            voucherType: "FLAG_GRANT",
            status: "ACTIVE",
            appliesFromInvoice: null,
            applicationsCount: 0,
            applicationsMax: null,
            effectiveStartsAt: "2026-10-01T00:00:00Z",
            effectiveExpiresAt: "2027-01-01T00:00:00Z",
          },
          {
            name: "Combined",
            voucherType: "COMPOSITE",
            status: "ACTIVE",
            appliesFromInvoice: "next",
            applicationsCount: 0,
            applicationsMax: 1,
            effectiveStartsAt: "2026-10-01T00:00:00Z",
            effectiveExpiresAt: null,
          },
          {
            name: "Gone",
            voucherType: "PRICE",
            status: "EXPIRED",
            appliesFromInvoice: null,
            applicationsCount: 3,
            applicationsMax: 3,
            effectiveStartsAt: "2026-06-01T00:00:00Z",
            effectiveExpiresAt: null,
          },
        ];
      }),
    });
    mount(server, <VoucherEntry />);
    await screen.findByText("Active vouchers");

    const rows = [...document.querySelectorAll('[data-slot="voucher-redemption"]')].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      "Welcome 20%Applies from your next invoice. For 3 invoices.",
      "Early birdApplied to 1 of 3 invoices.",
      "Flag grantUntil Jan 1, 2027.",
      "CombinedApplies from your next invoice. For one invoice. Active.",
    ]);
  });

  test("in French", async () => {
    mount(sessionServer(), <VoucherEntry />, fr);
    await check("FIVEOFF", "Code promo", "Vérifier");

    expect(
      await screen.findByText(
        "Five off — S'applique dès votre prochaine facture. Sur une facture.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appliquer" })).toBeTruthy();
    await press("Appliquer");
    expect(await screen.findByText(/Five off appliqué\./)).toBeTruthy();
  });

  test("a subscription whose last payment failed is live too: a code can still be redeemed", async () => {
    const server = sessionServer({
      portal: trialPortal({}, (portal) => {
        portal.subscription.status = "PAST_DUE";
        portal.trial = null;
      }),
    });
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    expect(server.to("POST", "vouchers/validate")).toHaveLength(0);
  });

  test("a trial is a live subscription too", async () => {
    const server = sessionServer({ portal: trialPortal() });
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    expect(server.to("POST", "vouchers/validate")).toHaveLength(0);
  });
});

describe("a subscription that waits for its first payment", () => {
  test("has no field, and says a code can be added once the plan has started", async () => {
    const server = sessionServer({
      portal: trialPortal({}, (portal) => {
        portal.subscription.status = "INCOMPLETE";
        portal.trial = null;
      }),
    });
    mount(server, <VoucherEntry />);

    expect(
      await screen.findByText(
        "Your plan starts once your payment is confirmed. You can add a code after that.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Voucher code")).toBeNull();
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(0);
    expect(server.to("POST", "vouchers/validate")).toHaveLength(0);
  });
});

describe("no subscription", () => {
  test("is the check of a code: nothing is redeemed, the checkout applies it", async () => {
    const server = sessionServer({ portal: "portalNeverSubscribed" });
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByText("Five off — Applied at checkout.")).toBeTruthy();
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  test("a subscription that was canceled is no subscription to redeem on", async () => {
    const server = sessionServer({
      portal: trialPortal({}, (portal) => {
        portal.subscription.status = "CANCELED";
        portal.trial = null;
      }),
    });
    mount(server, <VoucherEntry />);

    await check("FIVEOFF");

    expect(await screen.findByText("Five off — Applied at checkout.")).toBeTruthy();
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(0);
  });
});

test("unstyled: plain markup, the same flow", async () => {
  const server = sessionServer();
  const { container } = mount(server, <VoucherEntry unstyled />);
  await screen.findByLabelText("Voucher code");
  type("Voucher code", "FIVEOFF");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
  });

  expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  expect(container.querySelector('[data-slot="voucher-offer"]')).not.toBeNull();
});
