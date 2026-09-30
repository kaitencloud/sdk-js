/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never };
import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
/** Entitlement type enumeration */
export type EntitlementType = "BOOLEAN" | "CONFIG" | "NUMBER" | "NUMBER_AI_CREDIT";

/**
 * Whether a version of a license may be served.
 *
 * Several versions of one family can be PUBLISHED at once, so this is not a
 * "current version" marker: which version a family resolves to is decided on top
 * of it, by taking the family's default version, or its highest-numbered published
 * one. DRAFT and ARCHIVED are both unservable and resolution treats them alike,
 * but one has never been offered and the other has been withdrawn.
 */
export type LicenseLifecycleState = "ARCHIVED" | "DRAFT" | "PUBLISHED";

/** License type enumeration */
export type LicenseType = "COMMUNITY" | "DEVELOPMENT" | "PAID" | "TRIAL";

export type LicensingSnapshotQueryVariables = Exact<{
  customerId?: string | null | undefined;
  customerSlug?: string | null | undefined;
}>;

export type LicensingSnapshotQuery = {
  licenses: {
    hasMore: boolean;
    nextCursor: string | null;
    items: Array<{
      id: string;
      name: string;
      slug: string;
      description: string;
      type: LicenseType;
      version: string;
      versionName: string | null;
      isDefault: boolean;
      lifecycleState: LicenseLifecycleState;
      family: { id: string };
      entitlements: Array<{
        entitlementSlug: string;
        entitlementName: string;
        entitlementType: string;
        licenseId: string;
        licenseSlug: string;
        value: Record<string, unknown>;
        unlimited: boolean;
        limitCapExceededOveragePercent: number | null;
        entitlement: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          type: EntitlementType | null;
          icon: string | null;
          unitSingular: string | null;
          unitPlural: string | null;
          saleUnitSingular: string | null;
          saleUnitPlural: string | null;
          saleUnitFactor: number | null;
          userFacing: boolean | null;
          displayOrder: number | null;
          entitlementGroups: Array<{ id: string; name: string; slug: string }> | null;
        };
      }>;
    }>;
  };
  customer: {
    id: string;
    slug: string;
    name: string;
    externalCustomerId: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: { id: string; name: string };
    updatedBy: { id: string; name: string };
    instances: Array<{
      id: string;
      slug: string;
      name: string;
      description: string;
      customerId: string;
      customerSlug: string;
      licenseId: string;
      licenseSlug: string;
      deploymentZoneId: string | null;
      startLicenseDate: string;
      endLicenseDate: string;
      metadata: Record<string, unknown> | null;
      createdAt: string;
      updatedAt: string;
      createdBy: { id: string; name: string };
      updatedBy: { id: string; name: string };
      entitlementUsage: Array<{
        entitlementId: string;
        entitlementSlug: string;
        licenseId: string;
        licenseSlug: string;
        value: Record<string, unknown>;
        limit: Record<string, unknown> | null;
        currentPeriodStart: string | null;
        currentPeriodEnd: string | null;
      }>;
    }>;
  } | null;
};

export type LicensingCatalogQueryVariables = Exact<{
  cursor?: string | null | undefined;
}>;

export type LicensingCatalogQuery = {
  licenses: {
    hasMore: boolean;
    nextCursor: string | null;
    items: Array<{
      id: string;
      name: string;
      slug: string;
      description: string;
      type: LicenseType;
      version: string;
      versionName: string | null;
      isDefault: boolean;
      lifecycleState: LicenseLifecycleState;
      family: { id: string };
      entitlements: Array<{
        entitlementSlug: string;
        entitlementName: string;
        entitlementType: string;
        licenseId: string;
        licenseSlug: string;
        value: Record<string, unknown>;
        unlimited: boolean;
        limitCapExceededOveragePercent: number | null;
        entitlement: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          type: EntitlementType | null;
          icon: string | null;
          unitSingular: string | null;
          unitPlural: string | null;
          saleUnitSingular: string | null;
          saleUnitPlural: string | null;
          saleUnitFactor: number | null;
          userFacing: boolean | null;
          displayOrder: number | null;
          entitlementGroups: Array<{ id: string; name: string; slug: string }> | null;
        };
      }>;
    }>;
  };
};

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>["__apiType"]>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const LicensingSnapshotDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<LicensingSnapshotQuery, LicensingSnapshotQueryVariables>;
export const LicensingCatalogDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<LicensingCatalogQuery, LicensingCatalogQueryVariables>;
