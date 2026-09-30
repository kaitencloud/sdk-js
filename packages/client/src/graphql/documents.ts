import { graphql } from "./generated/gql.ts";

/**
 * The licensing catalog in ONE query: every license with its entitlement grants
 * and, per grant, the full entitlement definition (presentation metadata:
 * icon, units, userFacing, displayOrder, groups). Replaces the REST fan-out
 * (GET /licenses + one GET /licenses/{slug}/entitlements per license) that also
 * dropped every presentation field.
 */
/**
 * The composed licensing snapshot in ONE query: the customer, its instances
 * with their live entitlement usage, plus the full plan catalog — replacing the
 * REST fan-out (customer + instances + N×license entitlements + usage). The
 * license selection is kept textually identical to LicensingCatalog's so both
 * map through the same catalog code path. Feature flags stay on OFREP (a REST
 * standard) and are fetched alongside.
 *
 * `entitlementUsage` selects the window bounds (`currentPeriodStart` /
 * `currentPeriodEnd`) and the `limit` the usage is measured against. The bounds
 * are what let this path answer a cadence at all: the API populates both
 * exactly when a reset period is configured, so an absent pair on a successful
 * read means "lifetime counter" and never "nobody asked". Dropping them is what
 * forced the snapshot to mark every window unknown.
 *
 * `licenses` is cursor-paginated (`LicensePage`), so the page size is pinned to
 * the server's `MaxLimit` (200 — see internal/shared/pagination) and both
 * `hasMore` and `nextCursor` are selected. This document only ever reads page
 * one: the customer and its instances ride along with it, and re-asking for
 * them on every extra page would multiply the round trip this query exists to
 * collapse. `LICENSING_LICENSES_PAGE_QUERY` below reads the rest.
 */
export const LICENSING_SNAPSHOT_QUERY = graphql(`
  query LicensingSnapshot($customerId: UUID, $customerSlug: String) {
    licenses(limit: 200) {
      items {
        id
        name
        slug
        description
        type
        version
        versionName
        isDefault
        lifecycleState
        family {
          id
        }
        entitlements {
          entitlementSlug
          entitlementName
          entitlementType
          licenseId
          licenseSlug
          value
          unlimited
          limitCapExceededOveragePercent
          entitlement {
            id
            name
            slug
            description
            type
            icon
            unitSingular
            unitPlural
            saleUnitSingular
            saleUnitPlural
            saleUnitFactor
            userFacing
            displayOrder
            entitlementGroups {
              id
              name
              slug
            }
          }
        }
      }
      hasMore
      nextCursor
    }
    customer(id: $customerId, slug: $customerSlug) {
      id
      slug
      name
      externalCustomerId
      createdBy {
        id
        name
      }
      createdAt
      updatedBy {
        id
        name
      }
      updatedAt
      instances {
        id
        slug
        name
        description
        customerId
        customerSlug
        licenseId
        licenseSlug
        deploymentZoneId
        startLicenseDate
        endLicenseDate
        metadata
        createdBy {
          id
          name
        }
        createdAt
        updatedBy {
          id
          name
        }
        updatedAt
        entitlementUsage {
          entitlementId
          entitlementSlug
          licenseId
          licenseSlug
          value
          limit
          currentPeriodStart
          currentPeriodEnd
        }
      }
    }
  }
`);

/**
 * The catalog on its own, and — with `$cursor` — every page of it after the
 * first.
 *
 * One document serves both because the two callers want the same license shape:
 * `getCatalog` asks for page one with no cursor, and both read paths follow
 * `nextCursor` through this same query. The license selection is textually
 * identical to `LicensingSnapshot`'s, which is what lets a snapshot's extra
 * pages come back through here and still map through one catalog code path.
 */
export const LICENSING_CATALOG_QUERY = graphql(`
  query LicensingCatalog($cursor: String) {
    licenses(limit: 200, cursor: $cursor) {
      items {
        id
        name
        slug
        description
        type
        version
        versionName
        isDefault
        lifecycleState
        family {
          id
        }
        entitlements {
          entitlementSlug
          entitlementName
          entitlementType
          licenseId
          licenseSlug
          value
          unlimited
          limitCapExceededOveragePercent
          entitlement {
            id
            name
            slug
            description
            type
            icon
            unitSingular
            unitPlural
            saleUnitSingular
            saleUnitPlural
            saleUnitFactor
            userFacing
            displayOrder
            entitlementGroups {
              id
              name
              slug
            }
          }
        }
      }
      hasMore
      nextCursor
    }
  }
`);
