// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { getModel, listModels, getConversionRule, listConversionRules } from "../core/index.ts";
import type {
  KaitenTransport,
  Model,
  PageModel,
  ListModelsData,
  ConversionRule,
  ListConversionRulesData,
} from "../core/index.ts";

export interface KaitenModelsModule {
  get(modelSlug: string): Promise<Model>;
  /** Cursor pagination is explicit, preserving the server's page and filters. */
  list(query?: ListModelsData["query"]): Promise<PageModel>;
}

export interface KaitenConversionRulesModule {
  get(licenseSlug: string, ruleId: string): Promise<ConversionRule>;
  list(
    licenseSlug: string,
    query?: ListConversionRulesData["query"],
  ): Promise<ConversionRule[] | null>;
}

export function createModelsModule(transport: KaitenTransport): KaitenModelsModule {
  return {
    get: (modelSlug) =>
      transport.run(
        (client) => getModel({ client, path: { modelSlug } }),
        `models.get(${modelSlug})`,
      ),
    list: (query) => transport.run((client) => listModels({ client, query }), "models.list()"),
  };
}

export function createConversionRulesModule(
  transport: KaitenTransport,
): KaitenConversionRulesModule {
  return {
    get: (licenseSlug, ruleId) =>
      transport.run(
        (client) => getConversionRule({ client, path: { licenseSlug, ruleId } }),
        `licenses.conversionRules.get(${licenseSlug}, ${ruleId})`,
      ),
    list: (licenseSlug, query) =>
      transport.run(
        (client) => listConversionRules({ client, path: { licenseSlug }, query }),
        `licenses.conversionRules.list(${licenseSlug})`,
      ),
  };
}
