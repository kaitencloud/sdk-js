// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The evaluation context a host gave, with the instance the provider is bound to
 * added as `kaiten.instanceSlug`, so that a flag granted on that instance applies.
 * What the host wrote is never overwritten: its own `kaiten.instanceSlug` wins, the
 * other members of its `kaiten` stay, and a `kaiten` that is not an object is left
 * alone. Nothing is added when the host named no instance.
 */
export function withInstanceSlug(
  context: Record<string, unknown>,
  instanceSlug: string | null,
): Record<string, unknown> {
  if (!instanceSlug) return context;
  const host = context["kaiten"];
  if (host !== undefined && !isRecord(host)) return context;
  if (isRecord(host) && host["instanceSlug"] !== undefined) return context;
  return { ...context, kaiten: { ...host, instanceSlug } };
}
