import type { Meta, StoryObj } from "@storybook/react-vite";
import { StrictMode } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import { initechSession } from "../../../.storybook/kaiten-mock.tsx";
import { portalDecorator, refusal } from "../../../.storybook/portal-mock.tsx";
import { AddOns, CurrentPlan, CustomerPortal, UsageMeters } from "./customer-portal.tsx";
import { InvoiceList } from "./sections/invoices-section.tsx";
import { VoucherEntry } from "./sections/voucher-section.tsx";

/**
 * A customer portal under `mode="customer-session"`, read through the real session client from what
 * Kaiten answered for Initech. Every story carries its own provider, built once for it: a story is a
 * customer in one situation, and the situation is the portal it is given and the refusals it is
 * scripted. `meta` carries none, because a nested provider with the same scope is a no-op.
 */
const meta: Meta<typeof CustomerPortal> = {
  title: "Flows/Customer portal (session)",
  component: CustomerPortal,
  decorators: [portalDecorator()],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

/** The recorded portal of an active subscription, changed the way a story says. */
function changed(change: (portal: Record<string, any>) => void): Record<string, any> {
  const portal: Record<string, any> = structuredClone(initechSession.portal);
  change(portal);
  return portal;
}

const trial = changed((portal) => {
  portal.subscription.status = "TRIAL";
  portal.subscription.trialEndsAt = "2026-11-01T00:00:00Z";
  portal.upcomingInvoice.boundaryAt = "2026-11-01T00:00:00Z";
});

const canceled = changed((portal) => {
  portal.subscription.status = "CANCELED";
  portal.subscription.cancelAtPeriodEnd = false;
  portal.upcomingInvoice = null;
  portal.capabilities = { ...portal.capabilities, unsubscribe: false, checkout: true };
});

/**
 * The recorded portal with the API calls of Initech at `used`: their 200,000 carry a 20% allowance,
 * so the API accepts usage up to 240,000.
 */
function apiCallsUsed(used: number): Record<string, any> {
  return changed((portal) => {
    const apiCalls = portal.entitlements.find(
      (entitlement: any) => entitlement.slug === "api-calls",
    );
    apiCalls.currentValue = used;
    apiCalls.percentageUsed = (used / apiCalls.limitValue.value) * 100;
  });
}

const [paid, failed] = initechSession.invoicesFirstPage.items;
const [billedOutside] = initechSession.invoicesLastPage.items;

/** Every status a customer meets in the list, the open ones first as the server serves them. */
const mixedInvoices = [
  {
    ...failed,
    id: "inv_open",
    status: "PUSHED",
    providerInvoiceNumber: "INV-0004",
    total: 4980,
    invoicePdfUrl: "https://pay.initech.test/i/4.pdf",
  },
  { ...failed, id: "inv_failed", providerInvoiceNumber: "INV-0003" },
  paid,
  {
    ...paid,
    id: "inv_void",
    status: "VOID",
    providerInvoiceNumber: "INV-0000",
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    paidAt: null,
  },
  billedOutside,
];

/** Waits for the portal's first read to be drawn. */
async function drawn(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByText("Pro", {}, SLOW);
  return canvas;
}

export const Full: Story = {
  name: "A portal in a customer session",
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    for (const title of [
      "Current plan",
      "Included features",
      "Usage meters",
      "Add-ons",
      "Invoices",
      "Voucher",
    ]) {
      await expect((await canvas.findAllByText(title, {}, SLOW)).length).toBeGreaterThan(0);
    }
    await expect(canvas.getByText(/^Renews on/)).toBeInTheDocument();
    await expect(
      await canvas.findByRole("button", { name: "Cancel subscription" }, SLOW),
    ).toBeInTheDocument();
  },
};

export const CancelAsked: Story = {
  name: "Cancelling: asked first",
  args: { elements: ["CurrentPlan"] },
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Cancel subscription" }));
    await expect(canvas.getByText(/Your subscription will end on/)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Cancel at period end" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Keep my subscription" })).toBeInTheDocument();
    // The button that was pressed is gone: the keyboard is on the question that replaced it.
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement).toBe(
        canvas.getByText(/Your subscription will end on/),
      ),
    );
  },
};

export const CancelScheduled: Story = {
  name: "Cancellation scheduled",
  args: { elements: ["CurrentPlan"] },
  decorators: [portalDecorator({ portal: "portalCanceling" })],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.getByText(/^Ends on/)).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Reactivate subscription" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  },
};

export const CancelAfterwards: Story = {
  name: "Cancelled just now",
  args: { elements: ["CurrentPlan"] },
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Cancel subscription" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel at period end" }));
    await expect(await canvas.findByText(/^Ends on/, {}, SLOW)).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Reactivate subscription" }),
    ).toBeInTheDocument();
  },
};

export const ClosingPeriod: Story = {
  name: "Cancelling while a billing period is being closed",
  args: { elements: ["CurrentPlan"] },
  decorators: [
    portalDecorator({ scripts: { "POST billing/cancel": [refusal("cancelBoundaryPending")] } }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Cancel subscription" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel at period end" }));
    await expect(
      await canvas.findByText(/We're closing your billing period/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const PastDue: Story = {
  name: "Payment past due",
  args: { elements: ["CurrentPlan", "InvoiceList"] },
  decorators: [portalDecorator({ portal: "portalPastDue" })],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.getAllByText("Payment failed").length).toBeGreaterThan(0);
    await expect(canvas.getByText("Your latest payment didn't go through.")).toBeInTheDocument();
    // A subscription past due is not said to renew.
    await expect(canvas.queryByText(/^Renews on/)).toBeNull();
  },
};

export const Trial: Story = {
  name: "In a trial",
  args: { elements: ["CurrentPlan"] },
  decorators: [portalDecorator({ portal: trial })],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.getByText("Trial")).toBeInTheDocument();
    await expect(canvas.getByText(/^Trial ends on/)).toBeInTheDocument();
  },
};

export const Canceled: Story = {
  name: "Subscription over",
  args: { elements: ["CurrentPlan"] },
  decorators: [portalDecorator({ portal: canceled })],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.getByText("Canceled")).toBeInTheDocument();
    await expect(canvas.getByText("Your subscription has ended.")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /subscription$/ })).toBeNull();
  },
};

export const ScheduledChange: Story = {
  name: "A plan change is scheduled",
  args: { elements: ["CurrentPlan"] },
  decorators: [portalDecorator({ portal: "portalScheduledChange" })],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.getByText(/^Changes to €490\.00\/year on/)).toBeInTheDocument();
  },
};

export const Unbound: Story = {
  name: "A session bound to the customer only",
  decorators: [portalDecorator({ portal: "portalCustomerWide" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // No instance: no plan, no limits, no add-ons. What a customer can still do is check a voucher.
    await expect(await canvas.findByLabelText("Voucher code", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.queryByText("Current plan")).toBeNull();
    await expect(canvas.queryByText("Add-ons")).toBeNull();
  },
};

export const Provenance: Story = {
  name: "Where a limit comes from",
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <UsageMeters />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("API calls", {}, SLOW);
    await userEvent.click(
      canvas.getByRole("button", { name: "How this limit is made up: API calls" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "How this limit is made up: Seats" }));
    await expect(canvas.getAllByRole("note").map((note) => note.textContent)).toEqual([
      "(100,000 base) × 2 voucher = 200,000",
      "5 base + 3 × 1 add-on = 8",
    ]);
  },
};

export const UsageInAnAllowance: Story = {
  name: "Usage past the grant, inside its allowance",
  decorators: [portalDecorator({ portal: apiCallsUsed(210_000) })],
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <UsageMeters />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("API calls", {}, SLOW);
    // The track runs to the ceiling, 240,000; the badge says 105% of what was granted.
    const bar = canvas.getByRole("progressbar", { name: "Progress: 210,000 of 200,000" });
    await expect(bar).toHaveAttribute("data-usage-state", "in_allowance");
    await expect(bar).toHaveAttribute("aria-valuemax", "240000");
    await expect(canvas.getByText("105%")).toBeInTheDocument();
  },
};

export const UsageOnTheCeiling: Story = {
  name: "Usage on the ceiling of its allowance",
  decorators: [portalDecorator({ portal: apiCallsUsed(240_000) })],
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <UsageMeters />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("API calls", {}, SLOW);
    const bar = canvas.getByRole("progressbar", { name: "Progress: 240,000 of 200,000" });
    await expect(bar).toHaveAttribute("data-usage-state", "at_limit");
    await expect(canvas.getByText("120%")).toBeInTheDocument();
  },
};

/** The add-ons card in a column of its own, as a host might lay it out. */
function AddOnsColumn({ unstyled = false }: { unstyled?: boolean }) {
  return (
    <div className="w-full max-w-md">
      <AddOns unstyled={unstyled} />
    </div>
  );
}

/** Opens the add-ons panel from the card, and waits for it: the dialog, and queries within it. */
async function openPanel(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "Manage add-ons" }, SLOW));
  const dialog = await canvas.findByRole("dialog", { name: "Manage add-ons" }, SLOW);
  return { dialog, panel: within(dialog) };
}

/** In the panel: two more seats, and the GPU pack removed. Nothing is sent. */
async function changeTwo(panel: ReturnType<typeof within>) {
  await userEvent.click(panel.getByRole("button", { name: "Add one Extra seats" }));
  await userEvent.click(panel.getByRole("button", { name: "Add one Extra seats" }));
  await userEvent.click(panel.getByRole("button", { name: "Remove one GPU pack" }));
}

export const AddOnsHeld: Story = {
  name: "Add-ons: what the instance holds",
  render: () => <AddOnsColumn />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Extra seats", {}, SLOW);
    // A list to read: the quantities change in the panel, not here.
    await expect(canvas.getByText("× 3")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Add one Extra seats" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Manage add-ons" })).toBeInTheDocument();
  },
};

export const ManageAddOns: Story = {
  name: "Add-ons: the panel, with changes to confirm",
  render: () => <AddOnsColumn />,
  play: async ({ canvasElement }) => {
    const { dialog, panel } = await openPanel(canvasElement);
    // The keyboard is in the panel, which the browser holds it in.
    await waitFor(() =>
      expect(dialog.contains(canvasElement.ownerDocument.activeElement)).toBe(true),
    );
    await changeTwo(panel);
    await expect(panel.getByLabelText("Quantity of Extra seats")).toHaveTextContent("5");
    // Each change, at the add-on's own price, and when it is billed.
    await expect(panel.getByText("+2 × €10.00/month")).toBeInTheDocument();
    await expect(
      panel.getByText(/^Takes effect now, and is billed from your renewal on/),
    ).toBeInTheDocument();
    await expect(panel.getByText(/^Removed now\./)).toBeInTheDocument();
    await expect(panel.getByRole("button", { name: "Confirm changes" })).not.toHaveAttribute(
      "aria-disabled",
    );
  },
};

export const ManageAddOnsRefused: Story = {
  name: "Add-ons: a change the API refuses",
  render: () => <AddOnsColumn />,
  decorators: [
    portalDecorator({ scripts: { "PUT addons/extra-seats-v1": [refusal("addonIncompatible")] } }),
  ],
  play: async ({ canvasElement }) => {
    const { panel } = await openPanel(canvasElement);
    await changeTwo(panel);
    await userEvent.click(panel.getByRole("button", { name: "Confirm changes" }));
    // The first change was refused: the panel says why, of that add-on, and sent nothing after it.
    await expect(
      await panel.findByText(
        "Extra seats: This add-on isn't available with your plan or its billing period.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await expect(panel.getByLabelText("Quantity of GPU pack")).toHaveTextContent("0");
  },
};

export const ManageAddOnsClosingPeriod: Story = {
  name: "Add-ons: a billing period is being closed",
  render: () => <AddOnsColumn />,
  decorators: [
    portalDecorator({
      scripts: { "PUT addons/extra-seats-v1": [refusal("cancelBoundaryPending")] },
    }),
  ],
  play: async ({ canvasElement }) => {
    const { panel } = await openPanel(canvasElement);
    await userEvent.click(panel.getByRole("button", { name: "Add one Extra seats" }));
    await userEvent.click(panel.getByRole("button", { name: "Confirm changes" }));
    await expect(
      await panel.findByText(/We're closing your billing period/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const ManageAddOnsDone: Story = {
  name: "Add-ons: the changes went through",
  render: () => <AddOnsColumn />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const { panel } = await openPanel(canvasElement);
    await changeTwo(panel);
    await userEvent.click(panel.getByRole("button", { name: "Confirm changes" }));
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull(), SLOW);
    // The card is what the server now holds, and says the changes were made.
    await expect(await canvas.findByText("× 5", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.queryByText("GPU pack")).toBeNull();
    await expect(canvas.getByText("Your add-ons have been updated.")).toBeInTheDocument();
    // The keyboard is back on the button that opened the panel.
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement).toBe(
        canvas.getByRole("button", { name: "Manage add-ons" }),
      ),
    );
  },
};

export const ManageAddOnsDark: Story = {
  name: "Add-ons: the panel, in dark",
  render: () => <AddOnsColumn />,
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    const { panel } = await openPanel(canvasElement);
    await changeTwo(panel);
    await expect(panel.getByText("+2 × €10.00/month")).toBeInTheDocument();
  },
};

export const ManageAddOnsUnstyled: Story = {
  name: "Add-ons: the panel, unstyled",
  render: () => <AddOnsColumn unstyled />,
  play: async ({ canvasElement }) => {
    const { dialog, panel } = await openPanel(canvasElement);
    // The native dialog and plain buttons, for the host to style.
    await expect(dialog.tagName).toBe("DIALOG");
    await changeTwo(panel);
    await expect(panel.getByRole("heading", { name: "Your changes" })).toBeInTheDocument();
  },
};

export const ManageAddOnsStrictMode: Story = {
  name: "Add-ons: the panel, under StrictMode",
  // StrictMode runs a component's effects, their cleanup, then the effects again: the panel must
  // stay open through that, as it does in a host's development build.
  render: () => (
    <StrictMode>
      <AddOnsColumn />
    </StrictMode>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const { dialog } = await openPanel(canvasElement);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(canvas.getByRole("dialog", { name: "Manage add-ons" })).toBe(dialog);
    await expect((dialog as HTMLDialogElement).open).toBe(true);
  },
};

export const ManageAddOnsFromThePlan: Story = {
  name: "Add-ons: the panel, opened from the plan",
  args: { elements: ["CurrentPlan", "AddOns"] },
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    const [fromThePlan] = await canvas.findAllByRole("button", { name: "Manage add-ons" }, SLOW);
    await userEvent.click(fromThePlan!);
    const panel = within(await canvas.findByRole("dialog", { name: "Manage add-ons" }, SLOW));
    await userEvent.click(panel.getByRole("button", { name: "Remove one Extra seats" }));
    await expect(panel.getByText(/^Takes effect now\. Your renewal on/)).toBeInTheDocument();
    // Escape drops what was set, and the keyboard is back where it was.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(canvasElement.ownerDocument.activeElement).toBe(fromThePlan));
  },
};

export const Invoices: Story = {
  name: "Invoices",
  render: () => (
    <div className="w-full max-w-2xl">
      <InvoiceList />
    </div>
  ),
  decorators: [portalDecorator({ invoices: mixedInvoices })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("INV-0004", {}, SLOW);
    const pay = canvas.getAllByRole("link", { name: /^Pay / });
    await expect(pay).toHaveLength(2);
    for (const link of pay) await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(canvas.getByText("ACME-2026-17")).toBeInTheDocument();
  },
};

export const InvoicesPaged: Story = {
  name: "Invoices: older ones follow",
  render: () => (
    <div className="w-full max-w-2xl">
      <InvoiceList />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Show older invoices" }, SLOW),
    ).toBeInTheDocument();
  },
};

export const InvoicesEmpty: Story = {
  name: "Invoices: none yet",
  render: () => (
    <div className="w-full max-w-2xl">
      <InvoiceList />
    </div>
  ),
  decorators: [portalDecorator({ invoices: [] })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("No invoices yet.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const InvoicesHidden: Story = {
  name: "Invoices: the portal says they are not the customer's to see",
  args: { elements: ["CurrentPlan", "InvoiceList"] },
  decorators: [
    portalDecorator({
      portal: changed((portal) => {
        portal.capabilities.invoices = false;
      }),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.queryByText("Invoices")).toBeNull();
  },
};

/** Types a code and checks it. */
async function check(canvasElement: HTMLElement, code: string) {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText("Voucher code", {}, SLOW), code);
  await userEvent.click(canvas.getByRole("button", { name: "Check" }));
  return canvas;
}

const voucher = {
  render: () => (
    <div className="w-full max-w-md">
      <VoucherEntry />
    </div>
  ),
} satisfies Story;

export const VoucherValid: Story = {
  ...voucher,
  name: "Voucher: a valid code",
  play: async ({ canvasElement }) => {
    const canvas = await check(canvasElement, "WELCOME20");
    await expect(
      await canvas.findByText("Welcome 20% — Applied at checkout.", {}, SLOW),
    ).toBeInTheDocument();
    // Typed once, and gone from the page.
    await expect(canvasElement.innerHTML).not.toContain("WELCOME20");
    await expect(canvas.getByLabelText("Voucher code")).toHaveValue("");
  },
};

export const VoucherRefused: Story = {
  ...voucher,
  name: "Voucher: a code that cannot be used",
  play: async ({ canvasElement }) => {
    const canvas = await check(canvasElement, "NOPE");
    await expect(await canvas.findByText("This code can't be used.", {}, SLOW)).toBeInTheDocument();
  },
};

export const VoucherRateLimited: Story = {
  ...voucher,
  name: "Voucher: too many attempts",
  decorators: [
    portalDecorator({ scripts: { "POST vouchers/validate": [refusal("voucherRateLimited")] } }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await check(canvasElement, "TRY");
    await expect(
      await canvas.findByText("Too many attempts. Try again in 2 minutes.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [portalDecorator({}, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Pro", {}, SLOW);
    await expect(await canvas.findByText("Factures", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Résilier l'abonnement" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Vérifier" })).toBeInTheDocument();
  },
};

export const Unstyled: Story = {
  name: "Unstyled",
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Cancel subscription" }, SLOW),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-slot="invoices"]')).not.toBeNull();
  },
};

/**
 * A plan that grants nothing to list: no entitlements, so no included features, no usage meters, and
 * no add-ons. Their cells are not drawn, and the cards that remain share the portal's rows: the
 * plan next to the payment method, the voucher beside the plan's neighbour, the invoices below.
 */
export const NothingToList: Story = {
  name: "A plan with no entitlements: no hole in the grid",
  decorators: [
    portalDecorator({
      portal: changed((portal) => {
        portal.entitlements = [];
        portal.addOns = [];
      }),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    for (const title of ["Current plan", "Payment method", "Voucher", "Invoices"]) {
      await expect((await canvas.findAllByText(title, {}, SLOW)).length).toBeGreaterThan(0);
    }
    for (const title of ["Included features", "Usage meters", "Add-ons"]) {
      await expect(canvas.queryByText(title)).toBeNull();
    }
  },
};

/** A plan card of the host's own cancels nothing. */
export const PlanCardAlone: Story = {
  name: "A plan card on its own: no controls",
  render: () => (
    <div className="w-full max-w-md">
      <CurrentPlan />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = await drawn(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  },
};
