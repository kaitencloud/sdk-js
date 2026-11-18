// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The portals that the stories of the licence's usage read, beside the ones Kaiten recorded.
//
// Each is the portal recorded for Initech (`session.initech.json`) with its entitlements changed,
// and every entitlement is shaped as the portal shapes one: the members the contract declares, with
// the types and the nullability it gives them. `tests/license-usage-portals.test.ts` holds each of
// them to the contract, so that a story never draws an answer Kaiten could not send.

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

export type Portal = Record<string, any>;

/** The recorded portal of an instance on Pro, a copy to change. */
const recorded = (): Portal => structuredClone(answers.portal);

/**
 * A number as the portal sends it: a plain grant of the licence, counted over its lifetime. `-1` is
 * the unlimited sentinel, which carries no ceiling and no share; `used` is `null` when the server
 * could not measure the usage, and the share with it.
 */
export function quota(
  slug: string,
  name: string,
  limit: number,
  used: number | null,
  allowancePercent = 0,
): Portal {
  const unlimited = limit === -1;
  return {
    slug,
    name,
    type: "NUMBER",
    limitValue: { type: "number", value: limit },
    currentValue: used,
    unlimited,
    limitCapExceededOveragePercent: unlimited ? -1 : allowancePercent,
    maximumAllowedUsage: unlimited ? null : Math.floor((limit * (100 + allowancePercent)) / 100),
    percentageUsed: unlimited || used === null || limit === 0 ? null : (used / limit) * 100,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    source: "license",
    provenance: null,
  };
}

/** The recorded portal on another licence, which grants these quotas and nothing else. */
function onLicense(name: string, slug: string, entitlements: Portal[]): Portal {
  const portal = recorded();
  portal.instance = { ...portal.instance, licenseSlug: slug, licenseName: name };
  portal.entitlements = entitlements;
  return portal;
}

/**
 * A Kaiten licence, as Kaiten sells them today: every quota unlimited, each with what the
 * organization has used, which is the only figure a customer has to look at.
 */
export function kaitenLicense(): Portal {
  return onLicense("Kaiten Enterprise", "kaiten-enterprise", [
    quota("customers", "Customers", -1, 187),
    quota("instances", "Instances", -1, 4),
    quota("seats", "Seats", -1, 12),
    quota("webhooks", "Webhooks", -1, 6),
  ]);
}

/**
 * The recorded portal with the API calls at `used`. Their 200,000 carry a 20% allowance, so the API
 * accepts usage up to 240,000: 192,000 is where they come within a fifth of it.
 */
export function apiCallsUsed(used: number): Portal {
  const portal = recorded();
  const apiCalls = portal.entitlements.find((each: Portal) => each.slug === "api-calls");
  apiCalls.currentValue = used;
  apiCalls.percentageUsed = (used / apiCalls.limitValue.value) * 100;
  return portal;
}

/**
 * Three quotas of a hard 100 and a 20% allowance, used past it in each of the three ways that call
 * for a look: inside the allowance, on the ceiling the API accepts up to, and past it.
 */
export function pastTheGrant(): Portal {
  return onLicense("Pro", "pro-v2", [
    quota("api-calls", "API calls", 100, 110, 20),
    quota("projects", "Projects", 100, 120, 20),
    quota("storage", "Storage", 100, 130, 20),
  ]);
}

/** The recorded portal whose server could not measure the seats: the grant is known, the usage is not. */
export function seatsUnmeasured(): Portal {
  const portal = recorded();
  const seats = portal.entitlements.find((each: Portal) => each.slug === "seats");
  seats.currentValue = null;
  seats.percentageUsed = null;
  return portal;
}
