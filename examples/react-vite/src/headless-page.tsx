import { createMockKaitenClient, demoCatalog } from "@kaitencloud/client/testing";
import { Gate, KaitenProvider, usePlans } from "@kaitencloud/react";

// The headless core renders nothing of its own: the hooks hand over the data, and
// every element below belongs to this app. It is the path for a product that draws
// everything in its own design system, and it never loads the components' code or
// stylesheet.
const catalog = demoCatalog();
const client = createMockKaitenClient();

function formatPrice(
  amountInCents: number | null | undefined,
  currency: string | null | undefined,
) {
  if (amountInCents == null) return "Contact us";
  return new Intl.NumberFormat("en", { style: "currency", currency: currency ?? "EUR" }).format(
    amountInCents / 100,
  );
}

function PlanCards() {
  const { data: plans } = usePlans();
  return (
    <ul className="plans">
      {/* A plan marked unpublished stays off a public page, as PricingTable does. */}
      {(plans ?? [])
        .filter((plan) => plan.published !== false)
        .map((plan) => (
          <li key={plan.slug} className={plan.highlighted ? "plan plan-highlighted" : "plan"}>
            <strong>{plan.name}</strong>
            <span>{formatPrice(plan.price, plan.currencyCode)}</span>
          </li>
        ))}
    </ul>
  );
}

export function HeadlessPage() {
  return (
    <>
      <section>
        <h2>Plans, drawn by this app</h2>
        <KaitenProvider mode="static" catalog={catalog}>
          <PlanCards />
        </KaitenProvider>
      </section>
      <section>
        <h2>A gate around this app's own button</h2>
        <KaitenProvider
          mode="authenticated"
          accessToken="demo"
          customerId="acme"
          client={client}
          polling={{ enabled: false }}
        >
          <Gate entitlement="api_calls">
            {({ blocked }) =>
              blocked ? (
                <p className="notice">
                  Your plan's API calls are used up. <a href="#components">See the plans</a>.
                </p>
              ) : (
                <button type="button" className="button">
                  Call the API
                </button>
              )
            }
          </Gate>
        </KaitenProvider>
      </section>
    </>
  );
}
