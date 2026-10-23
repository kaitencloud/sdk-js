// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

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
    quotaInAllowance: (name) => `${name} dépasse la quantité incluse, dans la limite tolérée.`,
    quotaAtLimit: (name) => `${name} a atteint sa limite.`,
    quotaOverLimit: (name) => `${name} est au-delà de sa limite.`,
    usageUnavailable: "Consommation indisponible",
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
    inAllowance: "Dépassement toléré",
    atLimit: "Limite atteinte",
    overLimit: "Au-delà de la limite",
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
    title: "Paiement",
    summary: "Récapitulatif",
    quantity: (name) => `Quantité de ${name}`,
    decrease: (name) => `Retirer un ${name}`,
    increase: (name) => `Ajouter un ${name}`,
    voucherLabel: "Code promo",
    voucherApply: "Appliquer",
    voucherApplied: "Code promo appliqué",
    voucherRemove: "Retirer le code promo",
    voucherInvalid: "Ce code ne peut pas être utilisé.",
    rateLimited: "Trop de tentatives. Réessayez dans un instant.",
    voucherPending: "Appliquez le code, ou videz le champ, pour continuer.",
    billingEmail: "E-mail de facturation",
    billingEmailHint: "Les factures sont envoyées à cette adresse.",
    billingEmailToSubscribe: "Saisissez votre e-mail de facturation pour souscrire.",
    billingEmailFirst: "Saisissez votre e-mail de facturation pour voir ce qui est dû aujourd'hui.",
    dueToday: "À payer aujourd'hui",
    todayAmount: (amount) => `${amount} aujourd'hui`,
    trialEndsOn: (isoDate) => `Fin de l'essai le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    choosePrice: "Choisissez une offre pour voir ce qui est dû aujourd'hui.",
    quotaExceeded: (names) =>
      `Votre usage dépasse ce que cette offre inclut : ${names}. Choisissez une offre plus large, ou des options.`,
    unavailable:
      "Le prestataire de paiement est injoignable pour le moment. Réessayez dans un instant.",
    error: "Impossible de finaliser. Veuillez réessayer.",
    notSold: "Cette offre ne peut pas être achetée en ligne.",
    subscribe: "Souscrire",
    processing: "Traitement…",
    cancel: "Annuler",
    paymentNote:
      "Vos données de carte sont traitées par le prestataire de paiement. Elles n'arrivent jamais sur ce site.",
    awaitingPaymentMethod:
      "Enregistrez votre moyen de paiement dans la fenêtre que nous avons ouverte. Nous continuons dès votre retour.",
    reopenSetup: "Rouvrir la page",
    setupDone: "J'ai enregistré mon moyen de paiement",
    setupIncomplete:
      "Nous n'avons pas encore reçu de moyen de paiement. Rouvrez la page, ou vérifiez à nouveau.",
    subscribed: "Vous êtes abonné",
    nothingDue: "Rien à payer aujourd'hui.",
    paymentReceived: "Paiement reçu.",
    receipt: "Voir le reçu",
    confirmPayment: "Confirmez votre paiement pour terminer.",
    completePayment: "Finaliser le paiement",
    waitingForPayment: "En attente de votre paiement…",
    paymentStillOpen:
      "Nous n'avons pas encore vu votre paiement. Nous vérifierons à nouveau à votre retour dans cette fenêtre.",
    paymentFailed: "Vous êtes abonné, mais votre carte a été refusée.",
    startsOncePaid: "Votre offre démarre dès que votre paiement est confirmé.",
    cardDeclined: "Votre carte a été refusée.",
    updatePaymentMethod: "Mettre à jour le moyen de paiement",
    paymentMethodUpdated: "Moyen de paiement mis à jour.",
    payInvoice: "Payer la facture",
    alreadySubscribed: "Vous avez déjà un abonnement.",
    managePlan: "Gérer votre abonnement",
    addOnHeld: (quantity) => `Vous en avez déjà ${quantity}`,
    periodsLimitedBy: (names) =>
      `Certaines périodes de facturation ne sont pas proposées, car elles ne peuvent pas facturer les options que vous avez déjà\u00a0: ${names}.`,
    addOnNotForPeriod: (names) =>
      `Cette période de facturation ne peut pas facturer les options que vous avez déjà\u00a0: ${names}. Choisissez-en une autre.`,
    addOnAlreadyHeld: (names) =>
      `Vous avez déjà ${names}. Vous pourrez en changer la quantité une fois votre abonnement commencé.`,
    addOnRefused: (names) => `Cette offre ne peut pas facturer ${names}.`,
  },
  anonymousCheckout: {
    nameLabel: "Nom",
    emailLabel: "E-mail",
    emailHint: "Cette adresse sert pour votre compte et votre facturation.",
    nameRequired: "Saisissez votre nom.",
    humanCheck: "Contrôle de sécurité",
    checking: "Contrôle de sécurité en cours…",
    checked: "Contrôle de sécurité réussi.",
    checkFailed:
      "Le contrôle de sécurité n'a pas pu se charger. Si un bloqueur de contenu ou un pare-feu l'en empêche, autorisez challenges.cloudflare.com, puis réessayez.",
    checkRetry: "Relancer le contrôle",
    checkFirst: "Le bouton est disponible une fois le contrôle de sécurité réussi.",
    continue: "Continuer",
    startFree: "Commencer gratuitement",
    startTrial: "Démarrer l'essai gratuit",
    continueToPayment: "Continuer vers le paiement",
    change: "Modifier mes choix",
    reviewFor: (email) => `Pour ${email}`,
    noCardNeeded: "Aucun moyen de paiement n'est demandé.",
    trialAlreadyUsed:
      "Cet e-mail a déjà bénéficié de l'essai de cette offre\u00a0: la première période est due aujourd'hui.",
    amountChanged: (was, now) =>
      `Le montant dû est passé de ${was} à ${now}. Vérifiez-le avant de continuer.`,
    detailsChanged: "Les conditions de votre commande ont changé. Vérifiez-les avant de continuer.",
    thenPrice: (price, isoDate) =>
      `Puis ${price} à partir du ${formatKaitenDate(isoDate, { locale: "fr-FR" })}, sauf si vous résiliez avant.`,
    completedFor: (email) => `Votre commande est enregistrée pour ${email}.`,
    continueLink: "Continuer",
    closedAbandoned:
      "Cette commande est restée ouverte trop longtemps et a été fermée. Rien n'a été prélevé.",
    closedExpired: "Le paiement n'est pas arrivé à temps, cette commande a donc été fermée.",
    startAgain: "Recommencer",
    lost: "Nous ne retrouvons pas cette commande dans ce navigateur.",
    lostAdvice:
      "Si vous avez déjà payé, ne payez pas à nouveau\u00a0: contactez-nous, nous vérifierons votre commande.",
    startNew: "Commencer une nouvelle commande",
    tryAgainIn: (seconds) =>
      seconds < 2
        ? "Réessayez dans un instant."
        : `Réessayez dans ${seconds < 90 ? `${seconds} secondes` : `${Math.ceil(seconds / 60)} minutes`}.`,
    turnstileFailed: "Nous n'avons pas pu valider le contrôle de sécurité. Passez-le à nouveau.",
    turnstileUnavailable: "Le contrôle de sécurité est injoignable pour le moment.",
    rateLimited: "Trop de tentatives.",
    notSelfServe: "Cette offre n'est pas vendue en ligne. Contactez-nous pour l'obtenir.",
    planUnavailable: "Cette offre ne peut pas être achetée pour le moment.",
    addonRefused: "Une des options choisies ne peut pas être achetée avec cette offre.",
    invalidEmail: "Cette adresse e-mail n'est pas valide.",
    quotaReached:
      "Nous ne pouvons pas accepter de nouvelle inscription pour le moment. Contactez-nous.",
    notAvailable: "L'inscription en ligne n'est pas disponible pour le moment.",
    sessionClosed: "Cette commande est déjà fermée.",
    dueTodayChanged:
      "Le montant dû a changé après l'enregistrement de votre moyen de paiement. Rien n'a été prélevé. Recommencez pour voir le nouveau montant.",
    network: "Nous n'avons pas pu joindre le serveur. Vérifiez votre connexion et réessayez.",
  },
  subscription: {
    trial: "Essai",
    active: "Actif",
    pastDue: "Paiement échoué",
    canceled: "Résilié",
    incomplete: "Paiement en attente",
    trialEndsOn: (isoDate) => `Fin de l'essai le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    endsOn: (isoDate) => `Se termine le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    changesOn: (price, isoDate) =>
      `Passe à ${price} le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}`,
    pastDueNotice: "Votre dernier paiement n'a pas abouti.",
    canceledNotice: "Votre abonnement est terminé.",
    incompleteNotice: "Votre offre démarre dès que votre paiement est confirmé.",
    none: "Aucun abonnement à afficher.",
    subscribe: "Souscrire",
  },
  portalBilling: {
    invoices: "Factures",
    noInvoices: "Aucune facture pour le moment.",
    invoicePeriod: (from, to) =>
      `${formatKaitenDate(from, { locale: "fr-FR" })} – ${formatKaitenDate(to, { locale: "fr-FR" })}`,
    kindActivation: "Activation",
    kindRenewal: "Renouvellement",
    kindFinal: "Facture finale",
    statusManual: "Facturée manuellement",
    statusPushed: "En attente de paiement",
    statusPaid: "Payée",
    statusFailed: "Paiement échoué",
    statusUncollectible: "Passée en perte",
    statusVoid: "Annulée",
    pay: "Payer",
    pdf: "PDF",
    loadMore: "Afficher les factures plus anciennes",
    cancel: "Résilier l'abonnement",
    cancelPrompt: (isoDate) =>
      `Votre abonnement prendra fin le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}. Vous gardez tout jusque-là, et vous pouvez revenir dessus avant.`,
    cancelTrialPrompt: "Votre essai prendra fin immédiatement et rien ne vous sera facturé.",
    cancelIncompletePrompt: "Votre offre ne démarrera pas et rien ne vous sera facturé.",
    cancelConfirm: "Résilier à la fin de la période",
    cancelNowConfirm: "Résilier maintenant",
    cancelKeep: "Garder mon abonnement",
    reactivate: "Réactiver l'abonnement",
    closingPeriod:
      "Nous clôturons votre période de facturation. Votre modification sera appliquée dans un instant.",
    stillClosing:
      "Votre période de facturation est encore en cours de clôture. Réessayez dans une minute.",
    unavailable:
      "Le prestataire de paiement est injoignable pour le moment. Réessayez dans un instant.",
    actionFailed: "Cela n'a pas fonctionné. Veuillez réessayer.",
    addonQuantity: (name) => `Quantité de ${name}`,
    addonLess: (name) => `Retirer un ${name}`,
    addonMore: (name) => `Ajouter un ${name}`,
    addonUpTo: (max) => `Jusqu'à ${max}`,
    addonsManage: "Gérer les options",
    addonsManageNote:
      "Choisissez combien vous voulez de chaque option. Rien ne change avant votre confirmation.",
    addonsNone: "Vous n'avez pas encore d'option.",
    addonsSummary: "Vos modifications",
    addonsNoChange: "Aucune modification pour l'instant.",
    addonsConfirm: "Confirmer les modifications",
    addonsCancel: "Annuler",
    addonsUpdated: "Vos options ont été mises à jour.",
    addonBilledFrom: (isoDate) =>
      `Effectif tout de suite, et facturé à partir de votre renouvellement du ${formatKaitenDate(isoDate, { locale: "fr-FR" })}.`,
    addonLowerFrom: (isoDate) =>
      `Effectif tout de suite. Votre renouvellement du ${formatKaitenDate(isoDate, { locale: "fr-FR" })} facture la nouvelle quantité, et rien n'est remboursé pour la période en cours.`,
    addonRemovedFrom: (isoDate) =>
      `Retirée tout de suite. Votre renouvellement du ${formatKaitenDate(isoDate, { locale: "fr-FR" })} ne la facture plus, et rien n'est remboursé pour la période en cours.`,
    addonEnding: (isoDate) =>
      `Effectif tout de suite. Votre abonnement se termine le ${formatKaitenDate(isoDate, { locale: "fr-FR" })} et n'est pas renouvelé.`,
    addonBilledFromTrialEnd: (isoDate) =>
      `Effectif tout de suite, et facturé à partir de la fin de votre essai le ${formatKaitenDate(isoDate, { locale: "fr-FR" })}.`,
    addonRemovedInTrial: (isoDate) =>
      `Retiré tout de suite. La fin de votre essai le ${formatKaitenDate(isoDate, { locale: "fr-FR" })} ne le facture pas.`,
    addonUnbilled: "Effectif tout de suite. Rien n'est facturé sans abonnement.",
    addonTrueUpNote:
      "Une quantité plus élevée peut aussi être facturée pour la période en cours, au maximum détenu pendant celle-ci, sur votre prochaine facture.",
    addonRefusedFor: (name, reason) => `${name}\u00a0: ${reason}`,
    addonNotPublic: "Cette option n'est plus disponible.",
    addonCurrencyMismatch: "Cette option n'est pas vendue dans la devise de votre abonnement.",
    addonIncompatible:
      "Cette option n'est pas disponible avec votre offre ou sa période de facturation.",
    addonQuantityExceedsMax: "C'est plus que ce que cette option permet.",
    addonOtherVersionAttached: "Votre offre comprend déjà une autre version de cette option.",
    addonSubscriptionIncomplete:
      "Votre offre démarre dès que votre paiement est confirmé. Vous pourrez modifier vos options ensuite.",
    addonInstanceRequired: "Les options ne peuvent pas être modifiées depuis cette page.",
    vouchers: "Code promo",
    voucherLabel: "Code promo",
    voucherCheck: "Vérifier",
    voucherInvalid: "Ce code ne peut pas être utilisé.",
    voucherAtCheckout: "Appliqué à la souscription.",
    voucherWait: (seconds) =>
      `Trop de tentatives. Réessayez dans ${seconds < 90 ? `${seconds} seconde${seconds === 1 ? "" : "s"}` : `${Math.ceil(seconds / 60)} minutes`}.`,
    provenance: "D'où vient cette limite",
    provenanceBase: "de base",
    provenanceAddOn: "option",
    provenanceVoucher: "code promo",
    provenanceWithAddOns: "avec les options",
    provenanceUnlimited: "Illimité avec un code promo",
  },
  paymentMethodCard: {
    title: "Moyen de paiement",
    none: "Aucun moyen de paiement enregistré.",
    card: "Carte",
    expires: (monthYear) => `Expire le ${monthYear}`,
    expired: "Expirée",
    failed: "Échec",
    expiredNotice:
      "Cette carte a expiré. Ajoutez-en une nouvelle pour continuer à payer automatiquement.",
    failedNotice: "Votre dernier paiement a échoué. Mettez à jour votre moyen de paiement.",
    add: "Ajouter un moyen de paiement",
    update: "Mettre à jour le moyen de paiement",
    manage: "Gérer dans le portail de facturation",
    opening: "Ouverture…",
    saving: "Enregistrement de votre moyen de paiement…",
    saved: "Moyen de paiement mis à jour.",
    incomplete:
      "Nous n'avons pas encore reçu de moyen de paiement. Ajoutez-en un, ou vérifiez à nouveau.",
    unavailable:
      "Le prestataire de paiement est injoignable pour le moment. Réessayez dans un instant.",
    error: "Un problème est survenu. Veuillez réessayer.",
  },
};
