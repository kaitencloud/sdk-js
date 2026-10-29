// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// `POST /storefront-api/checkout/completed`: what the storefront's backend does once a visitor's
// anonymous checkout has completed, so that the customer Kaiten made is named after the buyer's
// company and not after their e-mail address.
//
// Kaiten has no member for a buyer's company or name: the checkout takes an e-mail, and the
// completion names the customer and its instance after it. Linking the buyer to anything else is
// the vendor's job, and the vendor's backend does it with the server token: it reads the customer
// and the instance the completion made and writes the name it wants (`PUT /customers/{slug}` and
// `PUT /instances/{slug}`). That is all this route is.
//
// The page that posts is the visitor's browser, which a visitor can change, and nothing proves to
// this route that the caller holds the checkout: the e-mail is no secret (the slug of a checkout's
// customer is made of it, and both slugs are in the public CheckoutSession and in the completed
// event), so "the slugs and the e-mail" is in practice "the slugs". The route reads what Kaiten holds
// and writes only when the read agrees with the post:
//
// - the customer exists, and its billing e-mail is the e-mail posted (the e-mail typed at the
//   checkout is what the completion stored there);
// - Kaiten itself made the customer and the instance (`createdBy` is Kaiten's own identity), so that
//   nothing a person or a service made can be renamed through this route, whatever slug is posted;
// - the customer was made a few minutes ago at most, which bounds the time it can be named in;
// - its name is still that e-mail: a customer already named is not renamed again;
// - the instance belongs to that customer.
//
// What is left, and this example accepts: anyone who knows the slugs of a customer that a checkout
// made in the last few minutes, and that is still named after its e-mail, can name it once, with
// text of their own choice (the customer's name, the instance's name and its description), and can
// post that same naming again. They cannot touch a customer a person or a service made, one already
// named, one made longer ago, or one whose e-mail differs. The route cannot do better because it has
// no order to match the post against. A real shop proves that the caller holds the checkout: it
// names the customer when the signed `checkout_session.v1.completed` event arrives, which carries the
// same slugs and cannot be forged by a browser, or it has the page send the checkout's `ksc_` token
// to its backend, which reads the CheckoutSession with it and compares the session, the e-mail and
// both slugs. This route stays a page's call so that the example needs neither a webhook endpoint
// nor the token on the wire.
//
// The writes are two requests in a row, each one a full replacement of what was read a moment
// before, not a transaction. A change someone else makes in between (the dates, the metadata of the
// instance) is written back as it was read; `PATCH /instances/{slug}` carries only the status and the
// lifecycle stage, so `PUT` is the verb. A failure between the two leaves the customer named and the
// instance not: the page does not retry, and a second post goes on from there.
//
// Posting the same thing twice, while that time lasts, is the same as posting it once.

import { createKaitenClient, Customers, Instances, KaitenError } from "@kaitencloud/server";

import type { Route } from "./http.ts";

type Client = ReturnType<typeof createKaitenClient>;

export interface CheckoutCompletedRouteOptions {
  /**
   * A client that carries a `ksh_` token with `read:customers`, `write:customers`, `read:instances`
   * and `write:instances`.
   */
  client: Client;
  /** How long after Kaiten made a customer this route still names it, in milliseconds. Ten minutes. */
  namingWindowMs?: number;
  /** The clock, in milliseconds. A test sets it. */
  now?: () => number;
}

/** The path the page calls. */
export const CHECKOUT_COMPLETED_PATH = "/storefront-api/checkout/completed";

/**
 * The identity Kaiten acts as when it makes something on its own (the completion of an anonymous
 * checkout), as the API reports it in `createdBy.id`. A person or a service account has another.
 */
export const KAITEN_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

/** The longest name this route writes. Kaiten bounds none, and a name is shown in a list. */
const MAX_NAME_LENGTH = 200;
const MAX_BODY_BYTES = 4096;
const DEFAULT_NAMING_WINDOW_MS = 10 * 60_000;
const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json(status, { error, ...extra });

/** What the page posts, once it is known to be well formed. */
interface Order {
  customerSlug: string;
  instanceSlug: string;
  email: string;
  company: string | null;
  name: string | null;
}

/** A refusal of the post, said in a word, with the member it is about. */
class Invalid extends Error {
  readonly field: string;
  constructor(field: string) {
    super(field);
    this.field = field;
  }
}

/**
 * A control character, or one that changes how the text reads or where it ends without showing: the
 * zero-width characters, the line and paragraph separators, the bidirectional marks and the byte
 * order mark. A name is shown in the console, in a list and next to the contact.
 */
const hasUnsafeCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x200b && code <= 0x200f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    );
  });

function text(source: Record<string, unknown>, field: string, maxLength: number): string {
  const value = source[field];
  if (typeof value !== "string") throw new Invalid(field);
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > maxLength || hasUnsafeCharacter(trimmed)) {
    throw new Invalid(field);
  }
  return trimmed;
}

function optionalText(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Invalid(field);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_NAME_LENGTH || hasUnsafeCharacter(trimmed)) throw new Invalid(field);
  return trimmed;
}

function slug(source: Record<string, unknown>, field: string): string {
  const value = text(source, field, 100);
  if (value.length < 2 || !SLUG.test(value)) throw new Invalid(field);
  return value;
}

function readOrder(source: unknown): Order {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new Invalid("body");
  }
  const body = source as Record<string, unknown>;
  const email = text(body, "email", 254);
  if (!email.includes("@")) throw new Invalid("email");
  const order = {
    customerSlug: slug(body, "customerSlug"),
    instanceSlug: slug(body, "instanceSlug"),
    email,
    company: optionalText(body, "company"),
    name: optionalText(body, "name"),
  };
  // A visitor who gave neither has nothing to name the customer after: it stays the address.
  if (order.company === null && order.name === null) throw new Invalid("company");
  return order;
}

const sameText = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * What the customer and its instance are named after the purchase: the company, else the person's
 * name, and the person's name as the contact in the instance's description.
 */
function wantedNames(order: Order) {
  const name = (order.company ?? order.name)!;
  return {
    name,
    description: order.name === null ? null : `Contact: ${order.name}`,
  };
}

/**
 * The body as text, or `null` when it is longer than the limit. A declared length over the limit is
 * refused before a byte is read, and a body that declares none (or lies) is read in chunks and
 * dropped as soon as it passes the limit, so that an oversized body is never held whole.
 */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]).text();
}

/**
 * Whether a page's `Origin` is this server's own host. The scheme is left out on purpose: behind a
 * proxy that ends TLS the server sees `http` while the browser's page is `https`. This stops a page
 * of another site in a browser, and nothing more: a caller that is not a browser sets no `Origin`.
 */
function fromThisHost(origin: string, url: string): boolean {
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false;
  }
}

export function checkoutCompletedRoute(options: CheckoutCompletedRouteOptions): Route {
  const { client, namingWindowMs = DEFAULT_NAMING_WINDOW_MS, now = Date.now } = options;

  return async (request) => {
    if (new URL(request.url).pathname !== CHECKOUT_COMPLETED_PATH) return undefined;

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST" },
      });
    }

    // A page of another site must not make this server write to Kaiten with its token.
    const origin = request.headers.get("origin");
    if (origin !== null && !fromThisHost(origin, request.url)) {
      return refuse(403, "cross_origin");
    }

    let order: Order;
    try {
      const raw = await readBody(request);
      if (raw === null) return refuse(413, "too_large");
      order = readOrder(JSON.parse(raw));
    } catch (thrown) {
      return refuse(400, "invalid_request", {
        field: thrown instanceof Invalid ? thrown.field : "body",
      });
    }

    const wanted = wantedNames(order);
    try {
      const { data: customer } = await Customers.getCustomer({
        client,
        throwOnError: true,
        path: { customerSlug: order.customerSlug },
      });
      // A member Kaiten has no value for is absent, or `null`: neither is the address posted.
      if (
        typeof customer.billingEmail !== "string" ||
        !sameText(customer.billingEmail, order.email)
      ) {
        return refuse(403, "email_mismatch");
      }
      if (customer.createdBy.id !== KAITEN_ACTOR_ID) {
        return refuse(403, "not_made_by_a_checkout");
      }
      // A date that cannot be read is too late as well.
      if (!(now() - Date.parse(customer.createdAt) <= namingWindowMs)) {
        return refuse(409, "too_late");
      }
      // Renamed already: by this route (the same name, which is a repeated post) or by someone else.
      const customerNamed = customer.name === wanted.name;
      if (!customerNamed && !sameText(customer.name, order.email)) {
        return refuse(409, "already_named");
      }

      const { data: instance } = await Instances.getInstance({
        client,
        throwOnError: true,
        path: { instanceSlug: order.instanceSlug },
      });
      if (instance.customerSlug !== order.customerSlug || instance.customerId !== customer.id) {
        return refuse(403, "instance_of_another_customer");
      }
      // An instance a person added to the customer later is theirs, whatever it is named.
      if (instance.createdBy.id !== KAITEN_ACTOR_ID) {
        return refuse(403, "not_made_by_a_checkout");
      }
      // The name the completion gave is the address and its description is empty; a description
      // the vendor wrote when there is no contact to write is kept as it is.
      const description = wanted.description ?? instance.description;
      const instanceNamed = instance.name === wanted.name && instance.description === description;
      if (
        !instanceNamed &&
        !(sameText(instance.name, order.email) || instance.name === wanted.name)
      ) {
        return refuse(409, "already_named");
      }
      if (!instanceNamed && instance.description !== "" && instance.description !== description) {
        return refuse(409, "already_named");
      }

      // `PUT` replaces the resource: what is not sent is cleared (the domain, the external id), or
      // refused (a slug other than the one on record, integrations). The e-mail is sent back as it
      // is, since an omitted one is kept and an empty one removes it.
      if (!customerNamed) {
        await Customers.updateCustomer({
          client,
          throwOnError: true,
          path: { customerSlug: order.customerSlug },
          body: {
            name: wanted.name,
            billingEmail: customer.billingEmail,
            // Kaiten answers a member that has no value as `null`, which a replacement leaves out.
            ...(customer.domain == null ? {} : { domain: customer.domain }),
            ...(customer.externalCustomerId == null
              ? {}
              : { externalCustomerId: customer.externalCustomerId }),
          },
        });
      }
      if (!instanceNamed) {
        await Instances.updateInstance({
          client,
          throwOnError: true,
          path: { instanceSlug: order.instanceSlug },
          body: {
            name: wanted.name,
            description,
            customerId: instance.customerId,
            licenseId: instance.licenseId,
            startLicenseDate: instance.startLicenseDate,
            endLicenseDate: instance.endLicenseDate,
            ...(instance.metadata == null ? {} : { metadata: instance.metadata }),
            ...(instance.deploymentZoneId == null
              ? {}
              : { deploymentZoneId: instance.deploymentZoneId }),
          },
        });
      }

      return json(200, {
        customerName: wanted.name,
        instanceName: wanted.name,
        renamed: !customerNamed || !instanceNamed,
      });
    } catch (error) {
      if (error instanceof KaitenError) {
        if (error.status === 404) return refuse(404, "not_found");
        // The token is the server's, so a refusal of it is the developer's to read, in the log; the
        // page learns that naming failed. Never the token, and nothing of what Kaiten answered.
        console.error(
          error.status === 403 && error.code === "Auth.MissingScope"
            ? "[storefront] Kaiten refused to name a customer: KAITEN_API_TOKEN needs read:customers, write:customers, read:instances and write:instances."
            : `[storefront] Kaiten refused to name a customer: ${error.status} ${error.code}`,
        );
      } else {
        console.error("[storefront] Kaiten could not be reached to name a customer");
      }
      return refuse(502, "naming_unavailable");
    }
  };
}
