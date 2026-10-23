// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The names the webhook payload types had in 1.0.0.
//
// The contract now types a payload as it is delivered: `Foo` became `FooDelivered`, which adds the
// `via` marker and the session it names (`customerSessionId`, `checkoutSessionId`) to the same
// members. The generated code follows, and no longer has the old names. A 1.x release removes no
// export of 1.0.0, so each name that 1.0.0 published stays, as the type it is delivered as. The
// delivered type only adds optional members, so what a 1.0 host wrote against the old one still
// compiles. A payload added after 1.0.0 has no old name and is not listed.

import type {
  CustomerCreationRejectedDelivered,
  DeploymentDelivered,
  FeatureFlagEvaluatedDelivered,
  InstanceEntitlementCapExceededDelivered,
  InstanceEntitlementUsagePeriodRolledOverDelivered,
  InstanceEntitlementUsageReportAcceptedDelivered,
  InstanceEntitlementUsageWarningThresholdReachedDelivered,
  InstanceEntitlementValueGetDelivered,
  InstanceEntitlementValueGetDeliveredWritable,
  InstanceLifecycleStageChangedDelivered,
  InstanceStatusChangedDelivered,
  MetadataFieldReorderedDelivered,
  SystemTokenIssuanceDelivered,
} from "./generated/types.gen.ts";

/** @deprecated Named `CustomerCreationRejectedDelivered` since the contract types a payload as delivered. */
export type CustomerCreationRejected = CustomerCreationRejectedDelivered;
/** @deprecated Named `DeploymentDelivered` since the contract types a payload as delivered. */
export type Deployment = DeploymentDelivered;
/** @deprecated Named `FeatureFlagEvaluatedDelivered` since the contract types a payload as delivered. */
export type FeatureFlagEvaluated = FeatureFlagEvaluatedDelivered;
/** @deprecated Named `InstanceEntitlementCapExceededDelivered` since the contract types a payload as delivered. */
export type InstanceEntitlementCapExceeded = InstanceEntitlementCapExceededDelivered;
/** @deprecated Named `InstanceEntitlementUsagePeriodRolledOverDelivered` since the contract types a payload as delivered. */
export type InstanceEntitlementUsagePeriodRolledOver =
  InstanceEntitlementUsagePeriodRolledOverDelivered;
/** @deprecated Named `InstanceEntitlementUsageReportAcceptedDelivered` since the contract types a payload as delivered. */
export type InstanceEntitlementUsageReportAccepted =
  InstanceEntitlementUsageReportAcceptedDelivered;
/** @deprecated Named `InstanceEntitlementUsageWarningThresholdReachedDelivered` since the contract types a payload as delivered. */
export type InstanceEntitlementUsageWarningThresholdReached =
  InstanceEntitlementUsageWarningThresholdReachedDelivered;
/** @deprecated Named `InstanceEntitlementValueGetDelivered` since the contract types a payload as delivered. */
export type InstanceEntitlementValueGet = InstanceEntitlementValueGetDelivered;
/** @deprecated Named `InstanceEntitlementValueGetDeliveredWritable` since the contract types a payload as delivered. */
export type InstanceEntitlementValueGetWritable = InstanceEntitlementValueGetDeliveredWritable;
/** @deprecated Named `InstanceLifecycleStageChangedDelivered` since the contract types a payload as delivered. */
export type InstanceLifecycleStageChanged = InstanceLifecycleStageChangedDelivered;
/** @deprecated Named `InstanceStatusChangedDelivered` since the contract types a payload as delivered. */
export type InstanceStatusChanged = InstanceStatusChangedDelivered;
/** @deprecated Named `MetadataFieldReorderedDelivered` since the contract types a payload as delivered. */
export type MetadataFieldReordered = MetadataFieldReorderedDelivered;
/** @deprecated Named `SystemTokenIssuanceDelivered` since the contract types a payload as delivered. */
export type SystemTokenIssuance = SystemTokenIssuanceDelivered;
