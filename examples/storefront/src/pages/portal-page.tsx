import { CustomerPortal } from "@kaitencloud/react-ui";

export function PortalPage() {
  return (
    <section aria-labelledby="portal-title">
      <h1 id="portal-title">Your account</h1>
      <CustomerPortal />
    </section>
  );
}
