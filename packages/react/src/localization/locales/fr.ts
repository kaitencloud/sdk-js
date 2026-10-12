import { formatKaitenDate, formatKaitenUsageWindowBound } from "../date.ts";
import { formatKaitenMoney } from "../money.ts";
import { pluralize } from "../pluralize.ts";
import type { KaitenLocalization } from "../types.ts";

// French locale pack. Strings AND the money/date formatters are localized to
// fr-FR so a French host renders a fully French SDK (the default English
// pack used to leak into a French app). Pass via `locale={fr}` (from `@kaitencloud/react/locales`) on
// KaitenProvider.
export const fr: KaitenLocalization = {
  formatMoney: (amount, currencyCode) =>
    formatKaitenMoney(amount, currencyCode, { locale: "fr-FR" }),
  branding: {
    poweredBy: "Propulsé par Kaiten",
  },
  states: {
    loading: "Chargement",
    failed: "Échec du chargement",
    retry: "Réessayer",
  },
  pricingTable: {
    monthly: "Mensuel",
    annual: "Annuel",
    billingInterval: "Période de facturation",
    choosePlan: "Choisir cette offre",
    selectPlan: "Sélectionner",
    popular: "Populaire",
    recommended: "Recommandé",
    features: "Fonctionnalités",
    limits: "Limites",
    addOns: "Options",
    customPrice: "Sur devis",
    contactUs: "Nous contacter",
  },
  featureComparison: {
    title: "Comparatif des fonctionnalités",
    feature: "Fonctionnalité",
    general: "Général",
    included: "Inclus",
    config: "Config",
    unavailable: "—",
  },
  featureCatalog: {
    title: "Fonctionnalités du produit",
    description: "Explorez les capacités incluses dans chaque offre.",
    search: "Rechercher dans le catalogue...",
    allCategories: "Toutes",
    availableOn: "Disponible sur :",
    empty: "Aucune fonctionnalité ne correspond à ce filtre.",
  },
  billingSummary: {
    title: "Facturation et usage",
    description: "Gérez votre abonnement et vos quotas.",
    subscription: "Abonnement",
    currentCycleUsage: "Usage du cycle en cours",
    statusActive: "Actif",
    statusExpired: "Expiré",
    statusNotStarted: "Pas encore démarré",
    renewsOn: (isoDate) => `Renouvellement le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    expiredOn: (isoDate) => `Expiré le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    startsOn: (isoDate) => `Démarre le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    manageBilling: "Gérer la facturation",
    viewInvoices: "Voir les factures",
    upgrade: "Faire évoluer l'abonnement",
    quotaWarning: (name, percentage) => `${name} atteint ${percentage} % de sa limite.`,
    noUsage: "Aucun quota mesuré sur cette offre.",
  },
  customerPortal: {
    currentPlan: "Offre actuelle",
    includedFeatures: "Fonctionnalités incluses",
    usageMeters: "Compteurs d'usage",
    addOns: "Options",
    featureFlags: "Feature flags",
  },
  currentPlan: {
    title: "Offre actuelle",
    renewsOn: (date) => `Renouvellement le ${formatKaitenDate(date, { locale: "fr-FR" })}`,
    credits: "Crédits",
    upgradeVersion: "Changer d'offre",
    addQuota: "Ajouter du quota",
    addAddOns: "Ajouter une option",
  },
  includedFeatures: {
    title: "Fonctionnalités incluses",
    feature: "Fonctionnalité",
    usage: "Usage",
    limit: "Limite",
    status: "Statut",
    enabled: "Activé",
    disabled: "Désactivé",
    nearLimit: "Proche de la limite",
    overLimit: "Limite dépassée",
    config: "Config",
    unavailable: "—",
    unlimited: "Illimité",
    unlimitedGroup: (count) =>
      pluralize(count, {
        one: "1 fonctionnalité illimitée",
        other: "{n} fonctionnalités illimitées",
      }),
    rowSummary: (name, usage, limit, status) => `${name} : ${usage} sur ${limit}, ${status}.`,
  },
  usageMeters: {
    title: "Compteurs d'usage",
    currentWindow: (start, end) =>
      `Sur cette période : ${formatKaitenUsageWindowBound(start, { locale: "fr-FR" })} → ${formatKaitenUsageWindowBound(end, { locale: "fr-FR" })}`,
    lifetime: "Depuis toujours",
  },
  addOns: {
    title: "Options",
    active: "Active",
    available: "Disponible",
    remove: "Retirer",
    add: "Ajouter",
    quotaAndCredits: "Quota et crédits",
  },
  flagsSummary: {
    title: "Feature flags",
    runtimeEvaluation: "Évaluation à l'exécution",
    rollout: (percentage) =>
      pluralize(percentage, { one: "déploiement à 1 %", other: "déploiement à {n} %" }),
    enabled: "Activé",
    disabled: "Désactivé",
  },
  paywall: {
    limitReached: "Limite atteinte",
    approachingLimit: "Limite bientôt atteinte",
    featureUnavailable: "Fonctionnalité indisponible",
    notAvailable: "Non disponible",
    addQuota: "Ajouter du quota",
    addAddOn: "Ajouter une option",
    contactSales: "Contacter l'équipe commerciale",
    upgrade: "Mettre à niveau",
    dismiss: "Ignorer",
    flagDisabledDescription:
      "Cette fonctionnalité est actuellement bloquée pour ce client. Débloquez-la en changeant d'offre ou en activant l'option associée.",
    errorDescription:
      "Impossible de vérifier votre accès pour le moment. Veuillez réessayer dans un instant.",
    usageDescription: (current, limit) => `Vous avez utilisé ${current} sur ${limit} autorisés.`,
  },
  price: {
    perMonth: "/mois",
    perYear: "/an",
    everyMonths: "tous les {n} mois",
    everyYears: "tous les {n} ans",
    perUnit: "par {unit}",
    unit: "unité",
  },
  checkoutFlow: {
    title: "Récapitulatif",
    description: "Vérifiez votre sélection avant de continuer.",
    plan: "Offre",
    addOn: "Option",
    total: "Total",
    processing: "Traitement…",
    proceedToPayment: "Continuer",
    cancel: "Annuler",
    error: "Impossible de finaliser. Veuillez réessayer.",
    intervalShortMonth: "/mois",
    intervalShortYear: "/an",
    priceLabel: (price, interval) => {
      if (!interval) return price;
      if (interval === "month") return `${price} par mois`;
      if (interval === "year") return `${price} par an`;
      return `${price} par ${interval}`;
    },
  },
};
