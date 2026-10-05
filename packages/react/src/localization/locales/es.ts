import { formatKaitenDate, formatKaitenUsageWindowBound } from "../date.ts";
import { formatKaitenMoney } from "../money.ts";
import { pluralize } from "../pluralize.ts";
import type { KaitenLocalization } from "../types.ts";

// Spanish locale pack. Strings AND the money/date formatters are localized to
// es-ES so a Spanish host renders a fully Spanish SDK (the default English
// pack used to leak into a Spanish app). Pass via `locale={es}` (from `@kaitencloud/react/locales`) on
// KaitenProvider.
export const es: KaitenLocalization = {
  formatMoney: (amount, currencyCode) =>
    formatKaitenMoney(amount, currencyCode, { locale: "es-ES" }),
  branding: {
    poweredBy: "Con la tecnología de Kaiten",
  },
  states: {
    loading: "Cargando",
    failed: "Error al cargar",
    retry: "Reintentar",
  },
  pricingTable: {
    monthly: "Mensual",
    annual: "Anual",
    billingInterval: "Periodo de facturación",
    choosePlan: "Elegir este plan",
    selectPlan: "Seleccionar",
    popular: "Popular",
    recommended: "Recomendado",
    features: "Funcionalidades",
    limits: "Límites",
    addOns: "Complementos",
    customPrice: "Precio personalizado",
  },
  featureComparison: {
    title: "Comparativa de funcionalidades",
    feature: "Funcionalidad",
    general: "General",
    included: "Incluido",
    config: "Configuración",
    unavailable: "—",
  },
  featureCatalog: {
    title: "Funcionalidades del producto",
    description: "Explora las capacidades incluidas en cada plan.",
    search: "Buscar en el catálogo...",
    allCategories: "Todas",
    availableOn: "Disponible en:",
    empty: "Ninguna funcionalidad coincide con este filtro.",
  },
  billingSummary: {
    title: "Facturación y uso",
    description: "Gestiona tu suscripción y tus cuotas.",
    subscription: "Suscripción",
    currentCycleUsage: "Uso del ciclo actual",
    statusActive: "Activa",
    statusExpired: "Caducada",
    statusNotStarted: "Sin iniciar",
    renewsOn: (isoDate) => `Se renueva el ${formatKaitenDate(isoDate, { locale: "es-ES" })}`,
    expiredOn: (isoDate) => `Caducó el ${formatKaitenDate(isoDate, { locale: "es-ES" })}`,
    startsOn: (isoDate) => `Comienza el ${formatKaitenDate(isoDate, { locale: "es-ES" })}`,
    manageBilling: "Gestionar facturación",
    viewInvoices: "Ver facturas",
    upgrade: "Mejorar suscripción",
    quotaWarning: (name, percentage) => `${name} está al ${percentage} % de su límite.`,
    noUsage: "Ningún cupo medido en este plan.",
  },
  customerPortal: {
    currentPlan: "Plan actual",
    includedFeatures: "Funcionalidades incluidas",
    usageMeters: "Medidores de uso",
    addOns: "Complementos",
    featureFlags: "Feature flags",
  },
  currentPlan: {
    title: "Plan actual",
    renewsOn: (date) => `Renovación el ${formatKaitenDate(date, { locale: "es-ES" })}`,
    credits: "Créditos",
    upgradeVersion: "Cambiar de plan",
    addQuota: "Añadir cuota",
    addAddOns: "Añadir un complemento",
  },
  includedFeatures: {
    title: "Funcionalidades incluidas",
    feature: "Funcionalidad",
    usage: "Uso",
    limit: "Límite",
    status: "Estado",
    enabled: "Activado",
    disabled: "Desactivado",
    nearLimit: "Cerca del límite",
    overLimit: "Límite superado",
    config: "Configuración",
    unavailable: "—",
    unlimited: "Ilimitado",
    unlimitedGroup: (count) =>
      pluralize(count, {
        one: "1 funcionalidad ilimitada",
        other: "{n} funcionalidades ilimitadas",
      }),
    rowSummary: (name, usage, limit, status) => `${name}: ${usage} de ${limit}, ${status}.`,
  },
  usageMeters: {
    title: "Medidores de uso",
    currentWindow: (start, end) =>
      `En este periodo: ${formatKaitenUsageWindowBound(start, { locale: "es-ES" })} → ${formatKaitenUsageWindowBound(end, { locale: "es-ES" })}`,
    lifetime: "Desde siempre",
  },
  addOns: {
    title: "Complementos",
    active: "Activo",
    available: "Disponible",
    remove: "Quitar",
    add: "Añadir",
    quotaAndCredits: "Cuota y créditos",
  },
  flagsSummary: {
    title: "Feature flags",
    runtimeEvaluation: "Evaluación en tiempo de ejecución",
    rollout: (percentage) =>
      pluralize(percentage, { one: "despliegue al 1 %", other: "despliegue al {n} %" }),
    enabled: "Activado",
    disabled: "Desactivado",
  },
  paywall: {
    limitReached: "Límite alcanzado",
    approachingLimit: "Límite casi alcanzado",
    featureUnavailable: "Funcionalidad no disponible",
    notAvailable: "No disponible",
    addQuota: "Añadir cuota",
    addAddOn: "Añadir un complemento",
    contactSales: "Contactar con ventas",
    upgrade: "Mejorar plan",
    dismiss: "Descartar",
    flagDisabledDescription:
      "Esta funcionalidad está actualmente bloqueada para este cliente. Desbloquéela cambiando de plan o activando el complemento asociado.",
    errorDescription:
      "No se pudo verificar su acceso en este momento. Vuelva a intentarlo en un instante.",
    usageDescription: (current, limit) => `Ha utilizado ${current} de ${limit} permitidos.`,
  },
  checkoutFlow: {
    title: "Resumen",
    description: "Revise su selección antes de continuar.",
    plan: "Plan",
    addOn: "Complemento",
    total: "Total",
    processing: "Procesando…",
    proceedToPayment: "Continuar",
    cancel: "Cancelar",
    error: "No se pudo finalizar. Vuelva a intentarlo.",
    intervalShortMonth: "/mes",
    intervalShortYear: "/año",
    priceLabel: (price, interval) => {
      if (!interval) return price;
      if (interval === "month") return `${price} al mes`;
      if (interval === "year") return `${price} al año`;
      return `${price} por ${interval}`;
    },
  },
};
