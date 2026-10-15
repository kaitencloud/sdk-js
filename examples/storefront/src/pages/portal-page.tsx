import { CustomerPortal } from "@kaitencloud/react-ui";

export function PortalPage() {
  return (
    <section aria-labelledby="portal-title">
      <h1 id="portal-title" className="page-heading">
        Your account
      </h1>
      <CustomerPortal />
    </section>
  );
}
