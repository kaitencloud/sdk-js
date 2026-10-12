// A customer's whole journey through Kaiten, taken with @kaitencloud/client and
// @kaitencloud/server and nothing else: the catalogue is read with a publishable
// key, the vendor's backend mints a customer session, the customer previews a
// checkout, saves a card, subscribes, finds the invoice, cancels, changes their mind
// and is signed out.
//
// Every step does two things. It asserts what the journey promises. And it takes
// the answers the network carried, which are Kaiten's own JSON and not the values
// the SDKs made of them, and holds each to the response the contract declares for
// that operation and status: a member the contract calls required and the API
// leaves out, a `null` where the schema says a string, a status the contract never
// listed. The SDKs read the contract; this finds the API that does not keep to it.
//
// The steps are methods, in the order they have to run, so that the suite can make a
// test of each and a rehearsal can run them against a stand-in.

import { KaitenClient, KaitenError, KaitenSessionClient } from "@kaitencloud/client";
import type {
  CheckoutPreview,
  CheckoutRequiresPaymentMethod,
  CheckoutResult,
  CheckoutSubscribed,
} from "@kaitencloud/client";
import { createKaitenClient, CustomerSessions } from "@kaitencloud/server";
import type { Client, CreatedCustomerSession } from "@kaitencloud/server";
import { expect } from "vite-plus/test";

import type { Configuration } from "./configuration.ts";
import { contractProblemsOf, recordingFetch } from "./recording.ts";
import type { Exchange } from "./recording.ts";
import type { CompleteSetup } from "./setup.ts";

type Fetch = typeof globalThis.fetch;

export interface Io {
  /** The network. The global `fetch` when absent. */
  fetch?: Fetch;
  completeSetup: CompleteSetup;
}

/** The one `status` a checkout answered with, or a failed assertion that says which it was. */
function checkoutIs<S extends CheckoutResult["status"]>(
  result: CheckoutResult,
  status: S,
): Extract<CheckoutResult, { status: S }> {
  expect(result.status, `the checkout answered ${result.status}`).toBe(status);
  return result as Extract<CheckoutResult, { status: S }>;
}

export class Journey {
  private readonly recorder: ReturnType<typeof recordingFetch>;
  private readonly apiPrefix: string;
  private server?: Client;
  private sessionClient?: KaitenSessionClient;
  private minted?: CreatedCustomerSession;
  private revoked = false;
  private price?: { planSlug: string; id: string };
  private preview?: CheckoutPreview;
  private requiresPaymentMethod?: CheckoutRequiresPaymentMethod;
  private subscribed?: CheckoutSubscribed;

  private readonly configuration: Configuration;
  private readonly io: Io;

  constructor(configuration: Configuration, io: Io) {
    this.configuration = configuration;
    this.io = io;
    this.apiPrefix = new URL(configuration.apiUrl).pathname.replace(/\/+$/, "");
    this.recorder = recordingFetch(this.apiPrefix, io.fetch);
  }

  /** Every exchange so far, for a test to look at. */
  get exchanges(): readonly Exchange[] {
    return this.recorder.exchanges;
  }

  private need<T>(value: T | undefined, step: string): T {
    if (value === undefined) {
      throw new Error(`This step needs the step "${step}", which did not complete.`);
    }
    return value;
  }

  /**
   * Holds the exchanges since the last call to what must always be true of them,
   * and returns them. Each credential stays on its own routes; every answer fits the
   * contract.
   */
  private checked(): Exchange[] {
    const exchanges = this.recorder.since();
    for (const { method, path, requestHeaders } of exchanges) {
      const where = `${method} ${path}`;
      const authorization = requestHeaders.authorization;
      if (path === "/public/catalog") {
        expect(
          requestHeaders["x-kaiten-publishable-key"],
          `${where} carries the publishable key`,
        ).toBe("pk_…");
        expect(authorization, `${where} carries no bearer credential`).toBeUndefined();
      } else if (path.startsWith("/public/session/")) {
        expect(authorization, `${where} carries the customer session`).toBe("Bearer kst_…");
        expect(
          requestHeaders["x-kaiten-publishable-key"],
          `${where} carries no publishable key`,
        ).toBeUndefined();
      } else if (path.startsWith("/customer-sessions")) {
        expect(authorization, `${where} carries the vendor's token`).toBe("Bearer ksh_…");
      } else {
        expect.unreachable(`${where} is a route the journey has no reason to call`);
      }
    }
    const problems = contractProblemsOf(exchanges);
    if (problems.length > 0) {
      throw new Error(
        `Kaiten's answers do not fit the contract:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
      );
    }
    return exchanges;
  }

  private exchangeOf(exchanges: readonly Exchange[], method: string, path: string): Exchange {
    const found = exchanges.filter(
      (exchange) => exchange.method === method && exchange.path === path,
    );
    expect(found, `${method} ${path} was called once`).toHaveLength(1);
    return found[0]!;
  }

  /** The catalogue, read in a browser's way: a publishable key, and nothing else. */
  async catalogue(): Promise<void> {
    const { apiUrl, publishableKey, planSlug } = this.configuration;
    const client = new KaitenClient({
      apiUrl,
      authScheme: "publishable",
      tokenProvider: () => publishableKey,
      fetch: this.recorder.fetch,
    });

    const catalog = await client.getCatalog();

    const exchanges = this.checked();
    expect(
      exchanges.map(({ method, path }) => `${method} ${path}`),
      "a publishable key reads the catalogue and calls nothing else",
    ).toEqual(["GET /public/catalog"]);
    expect(exchanges[0]!.status).toBe(200);

    const plan =
      planSlug === undefined
        ? catalog.plans.find(
            (candidate) => candidate.selfServe === true && candidate.pricingType === "PAID",
          )
        : catalog.plans.find((candidate) => candidate.slug === planSlug);
    expect(
      plan,
      planSlug === undefined
        ? "the catalogue offers a plan a customer can buy alone, which is paid"
        : `the catalogue has a plan named ${planSlug}`,
    ).toBeDefined();
    const flatFee =
      plan!.billingPrices?.find((price) => price.billingModel === "FLAT_FEE" && price.isDefault) ??
      plan!.billingPrices?.find((price) => price.billingModel === "FLAT_FEE");
    expect(flatFee, `${plan!.slug} has a flat-fee price to subscribe to`).toBeDefined();
    this.price = { planSlug: plan!.slug, id: flatFee!.id };
  }

  /**
   * The vendor's backend mints a session for the customer and the instance, and the
   * customer's browser reads its portal with it. The instance must have no
   * subscription yet: the journey subscribes it, and a subscribed one cannot be.
   */
  async session(): Promise<void> {
    const { apiUrl, serverToken, customerSlug, instanceSlug } = this.configuration;
    this.server = createKaitenClient({
      baseUrl: apiUrl,
      token: serverToken,
      fetch: this.recorder.fetch,
    });

    const { data: created } = await CustomerSessions.createCustomerSession({
      client: this.server,
      throwOnError: true,
      body: { customerSlug, instanceSlug, ttlSeconds: 900 },
    });
    this.minted = created;

    const minting = this.checked();
    expect(this.exchangeOf(minting, "POST", "/customer-sessions").status).toBe(201);
    // A failing assertion prints what it received, and this log may be public while
    // the run streams: the token is judged without being handed to one.
    expect(
      /^kst_[A-Za-z0-9_-]{20,}$/.test(created.token),
      "the minted token has the shape of a customer session token",
    ).toBe(true);
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now());
    expect({ customerSlug: created.customerSlug, instanceSlug: created.instanceSlug }).toEqual({
      customerSlug,
      instanceSlug,
    });
    this.sessionClient = new KaitenSessionClient({
      apiUrl,
      fetch: this.recorder.fetch,
      getCustomerSession: () => ({ token: created.token, expiresAt: created.expiresAt }),
    });

    const portal = await this.sessionClient.getPortal();

    const reading = this.checked();
    expect(this.exchangeOf(reading, "GET", "/public/session/portal").status).toBe(200);
    expect(portal.customer.slug).toBe(customerSlug);
    expect(portal.instance?.slug).toBe(instanceSlug);
    expect(
      portal.subscription,
      `${instanceSlug} is subscribed already: the journey needs an instance with no subscription, a fresh one for each run`,
    ).toBeNull();
  }

  /** What the checkout would bill today, and nothing changed. */
  async dryRun(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    const price = this.need(this.price, "catalogue");

    const answer = await session.checkout({
      licensePriceId: price.id,
      billingEmail: this.configuration.billingEmail,
      trial: false,
      dryRun: true,
    });

    const exchanges = this.checked();
    expect(this.exchangeOf(exchanges, "POST", "/public/session/checkout").status).toBe(200);
    this.preview = checkoutIs(answer, "preview");
    expect(
      this.preview.dueToday.total,
      "a paid plan without its trial bills something today",
    ).toBeGreaterThan(0);
  }

  /** With no card saved, the checkout sends the customer to the provider's page. */
  async setup(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    const price = this.need(this.price, "catalogue");

    const answer = await session.checkout({
      licensePriceId: price.id,
      billingEmail: this.configuration.billingEmail,
      trial: false,
      returnUrl: this.configuration.returnUrl,
    });

    const exchanges = this.checked();
    expect(this.exchangeOf(exchanges, "POST", "/public/session/checkout").status).toBe(200);
    this.requiresPaymentMethod = checkoutIs(answer, "requires_payment_method");
    expect(Date.parse(this.requiresPaymentMethod.expiresAt)).toBeGreaterThan(Date.now());
    expect(this.requiresPaymentMethod.setupUrl).toMatch(/^https?:\/\//);
    expect(this.requiresPaymentMethod.setupSessionId).not.toBe("");

    await this.io.completeSetup({
      setupUrl: this.requiresPaymentMethod.setupUrl,
      setupSessionId: this.requiresPaymentMethod.setupSessionId,
    });
  }

  /** Back from the page, the same checkout subscribes, and bills what the preview said. */
  async checkout(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    const price = this.need(this.price, "catalogue");
    const preview = this.need(this.preview, "dryRun");
    const setup = this.need(this.requiresPaymentMethod, "setup");

    const answer = await session.checkout({
      licensePriceId: price.id,
      billingEmail: this.configuration.billingEmail,
      trial: false,
      setupSessionId: setup.setupSessionId,
      returnUrl: this.configuration.returnUrl,
    });

    const exchanges = this.checked();
    expect(this.exchangeOf(exchanges, "POST", "/public/session/checkout").status).toBe(201);
    this.subscribed = checkoutIs(answer, "subscribed");
    expect(this.subscribed.payment.status).toBe("paid");
    expect(this.subscribed.subscription).toMatchObject({
      status: "ACTIVE",
      providerKind: "STRIPE",
      collectionMethod: "CHARGE_AUTOMATICALLY",
      cancelAtPeriodEnd: false,
    });
    const invoice = this.subscribed.activationInvoice;
    expect(invoice, "a subscription that bills today has an activation invoice").not.toBeNull();
    expect(invoice!.kind).toBe("ACTIVATION");
    expect(
      { total: invoice!.total, currencyCode: invoice!.currencyCode },
      "the preview's total is the activation invoice's",
    ).toEqual({ total: preview.dueToday.total, currencyCode: preview.dueToday.currencyCode });
  }

  /** The invoice is listed, paid, with where to read it. */
  async invoices(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    const subscribed = this.need(this.subscribed, "checkout");

    const page = await session.listInvoices();

    const exchanges = this.checked();
    expect(this.exchangeOf(exchanges, "GET", "/public/session/invoices").status).toBe(200);
    const activation = subscribed.activationInvoice!;
    const listed = page.items.find((invoice) => invoice.id === activation.id);
    expect(listed, "the activation invoice is in the customer's invoices").toBeDefined();
    expect(listed).toMatchObject({ kind: "ACTIVATION", status: "PAID", total: activation.total });
    expect(listed!.hostedInvoiceUrl).toMatch(/^https:\/\//);
    expect(listed!.invoicePdfUrl).toMatch(/^https:\/\//);
  }

  /** The subscription ends with its period instead of renewing. */
  async cancel(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    this.need(this.subscribed, "checkout");

    const subscription = await session.cancelSubscription({ reason: "conformance" });

    const exchanges = this.checked();
    expect(this.exchangeOf(exchanges, "POST", "/public/session/billing/cancel").status).toBe(200);
    expect(subscription).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
  }

  /** The customer changes their mind, and it renews again. */
  async reactivate(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    this.need(this.subscribed, "checkout");

    const subscription = await session.reactivateSubscription();

    const exchanges = this.checked();
    expect(this.exchangeOf(exchanges, "POST", "/public/session/billing/reactivate").status).toBe(
      200,
    );
    expect(subscription).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: false });
  }

  /** The customer signs out: the session stops working on the next request, and revoking it again is safe. */
  async revoke(): Promise<void> {
    const session = this.need(this.sessionClient, "session");
    const server = this.need(this.server, "session");
    const minted = this.need(this.minted, "session");

    await CustomerSessions.revokeCustomerSession({
      client: server,
      throwOnError: true,
      path: { sessionId: minted.id },
    });
    this.revoked = true;
    await CustomerSessions.revokeCustomerSession({
      client: server,
      throwOnError: true,
      path: { sessionId: minted.id },
    });
    const refused = await session.getPortal().then(
      () => undefined,
      (error: unknown) => error,
    );

    const exchanges = this.checked();
    const revocations = exchanges.filter(
      ({ method, path }) => method === "POST" && path.endsWith("/revoke"),
    );
    expect(
      revocations.map(({ status }) => status),
      "revoking is idempotent",
    ).toEqual([204, 204]);
    expect(refused, "a revoked session is refused").toBeInstanceOf(KaitenError);
    expect(refused).toMatchObject({ status: 401, code: "PublicAuth.InvalidCredential" });
  }

  /** Leaves no live session behind when the journey stopped half way. Never throws. */
  async cleanUp(): Promise<void> {
    if (this.minted === undefined || this.server === undefined || this.revoked) return;
    try {
      await CustomerSessions.revokeCustomerSession({
        client: this.server,
        throwOnError: true,
        path: { sessionId: this.minted.id },
      });
    } catch {
      // The session ends by itself; the journey's own failure is the one to read.
    }
  }
}
