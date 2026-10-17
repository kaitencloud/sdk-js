// Where the portal's "Change plan" goes.
//
// In V1 a customer does not move themselves from one paid plan to another: a tier change is a
// commercial request, and the portal's button opens the plan's
// `selfServeCtaUrl`, the address the vendor gave that plan for starting the conversation.
// Immediate self-serve change, with proration, is V1.1.
//
// Which plan's address? The plan the customer is on. The vendor writes `selfServeCtaUrl` on each
// version of a plan, and the conversation starts from where the customer stands; the catalogue
// carries no order between plans, so the SDK has no "next plan" to look for. The storefront's own
// sales page takes the plan in its address (`/sales?plan=pro-v2`), so that whoever answers knows
// the starting point.
//
// Two plans have no address of their own to send to:
//
// - a free plan needs none: its subscription is replaced by a checkout, so "Change plan"
//   goes to the pricing table, where the customer buys what they want;
// - a paid plan whose vendor left the address empty goes to the storefront's sales page all the
//   same, because a button that does nothing is the one thing "Change plan" must not be.

/** What the choice needs to know of a plan of the catalogue. */
export interface PlanLink {
  slug: string;
  pricingType?: string;
  selfServeCtaUrl?: string | null;
}

/** A page of this storefront, or another site. */
export type ChangePlanTarget = { kind: "page"; to: string } | { kind: "external"; href: string };

/** The storefront's "Talk to sales" page. */
export const SALES_PATH = "/sales";

/** The sales page, for a plan. */
export const salesPath = (planSlug: string) => `${SALES_PATH}?plan=${encodeURIComponent(planSlug)}`;

/**
 * Where "Change plan" goes for a customer on `currentSlug`. `origin` is the storefront's own, so
 * that an address on it is followed inside the app, and any other opens as a site of its own.
 */
export function changePlanTarget(
  plans: readonly PlanLink[] | undefined,
  currentSlug: string | undefined,
  origin: string,
): ChangePlanTarget {
  const current = plans?.find((plan) => plan.slug === currentSlug);

  const address = current?.selfServeCtaUrl;
  if (address) {
    try {
      const url = new URL(address);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin === origin
          ? { kind: "page", to: `${url.pathname}${url.search}${url.hash}` }
          : { kind: "external", href: url.href };
      }
    } catch {
      // Not an address: the vendor's mistake is not a reason to send the customer nowhere.
    }
  }

  if (current?.pricingType === "FREE") return { kind: "page", to: "/" };
  return { kind: "page", to: currentSlug ? salesPath(currentSlug) : SALES_PATH };
}
