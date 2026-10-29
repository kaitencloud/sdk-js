// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { mapPublicCatalog } from "../src/client/billing.ts";
import { responseProblems } from "./support/contract-schema.ts";
import { answer } from "./support/session-answers.ts";
import { json, open, useSessionClock } from "./support/session-harness.ts";

// What the portal and the catalogue serve about an add-on's scheduled decrease, the price's billing
// timing and the "Powered by" mark, read on the shapes of the contract.
useSessionClock();

const read = async (body: unknown) => open(() => json(body)).client.getPortal();

/** The contract's portal, with the first add-on given a scheduled decrease. */
function portalWith(pendingQuantity: number | null | undefined) {
  const portal = answer("portal");
  const [first, ...rest] = portal.addOns;
  const { pendingQuantity: _, ...held } = first!;
  return {
    ...portal,
    addOns: [{ ...held, ...(pendingQuantity === undefined ? {} : { pendingQuantity }) }, ...rest],
  };
}

describe("the decrease an add-on has scheduled", () => {
  test.each([1, 0])("is read as %i, the quantity from the next renewal", async (pending) => {
    const body = portalWith(pending);
    const portal = await read(body);

    // The units held stay as they are: the decrease is a second figure, never applied to the first.
    expect(portal.addOns[0]).toMatchObject({ quantity: 3, pendingQuantity: pending });
    expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
  });

  test("is null when nothing is scheduled", async () => {
    const portal = await read(portalWith(null));

    expect(portal.addOns[0]?.pendingQuantity).toBeNull();
  });

  test("is absent from a server that does not send it: nothing is said of one", async () => {
    const portal = await read(portalWith(undefined));

    expect(portal.addOns[0]).not.toHaveProperty("pendingQuantity");
  });

  test("comes back with the quantity put, which stays the quantity held", async () => {
    const { client } = open(() => json({ ...answer("addon"), quantity: 5, pendingQuantity: 2 }));

    expect(await client.setAddonQuantity("extra-seats-v1", 2)).toMatchObject({
      quantity: 5,
      pendingQuantity: 2,
    });
  });
});

describe("the mark of the portal", () => {
  test("is removable when the portal says so, and only then", async () => {
    for (const [poweredByRemovable, removable] of [
      [true, true],
      [false, false],
    ] as const) {
      const portal = await read({ ...answer("portal"), branding: { poweredByRemovable } });

      expect(portal.branding).toEqual({ removable });
    }
  });

  test("is left out when the server does not send the member: the mark stays", async () => {
    const { branding: _, ...body } = answer("portal");
    const portal = await read(body);

    expect(portal).not.toHaveProperty("branding");
  });

  test("anything but a true reads as not removable", async () => {
    const portal = await read({ ...answer("portal"), branding: { poweredByRemovable: "yes" } });

    expect(portal.branding).toEqual({ removable: false });
  });
});

describe("the mark of the catalogue", () => {
  const wire = (branding?: unknown) => ({
    plans: [],
    addOns: [],
    capabilities: {
      checkout: false,
      paymentMethods: false,
      anonymousCheckout: false,
      turnstileSiteKey: null,
    },
    ...(branding === undefined ? {} : { branding }),
  });

  test("is removable when the catalogue says so", () => {
    expect(mapPublicCatalog(wire({ poweredByRemovable: true })).branding).toEqual({
      removable: true,
    });
    expect(mapPublicCatalog(wire({ poweredByRemovable: false })).branding).toEqual({
      removable: false,
    });
  });

  test("is not when it says nothing, or something else than true", () => {
    expect(mapPublicCatalog(wire()).branding).toEqual({ removable: false });
    expect(mapPublicCatalog(wire({ poweredByRemovable: 1 })).branding).toEqual({
      removable: false,
    });
  });
});
