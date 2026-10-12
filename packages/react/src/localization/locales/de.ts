import { formatKaitenDate, formatKaitenUsageWindowBound } from "../date.ts";
import { formatKaitenMoney } from "../money.ts";
import { pluralize } from "../pluralize.ts";
import type { KaitenLocalization } from "../types.ts";

// German locale pack. Strings AND the money/date formatters are localized to
// de-DE so a German host renders a fully German SDK (the default English
// pack used to leak into a German app). Pass via `locale={de}` (from `@kaitencloud/react/locales`) on
// KaitenProvider.
export const de: KaitenLocalization = {
  formatMoney: (amount, currencyCode) =>
    formatKaitenMoney(amount, currencyCode, { locale: "de-DE" }),
  branding: {
    poweredBy: "Bereitgestellt von Kaiten",
  },
  states: {
    loading: "Wird geladen",
    failed: "Laden fehlgeschlagen",
    retry: "Erneut versuchen",
  },
  pricingTable: {
    monthly: "Monatlich",
    annual: "Jährlich",
    billingInterval: "Abrechnungszeitraum",
    choosePlan: "Diesen Tarif wählen",
    selectPlan: "Auswählen",
    popular: "Beliebt",
    recommended: "Empfohlen",
    features: "Funktionen",
    limits: "Limits",
    addOns: "Zusatzoptionen",
    customPrice: "Preis auf Anfrage",
    contactUs: "Kontakt aufnehmen",
  },
  featureComparison: {
    title: "Funktionsvergleich",
    feature: "Funktion",
    general: "Allgemein",
    included: "Inbegriffen",
    config: "Konfiguration",
    unavailable: "—",
  },
  featureCatalog: {
    title: "Produktfunktionen",
    description: "Entdecken Sie die in jedem Tarif enthaltenen Funktionen.",
    search: "Katalog durchsuchen...",
    allCategories: "Alle",
    availableOn: "Verfügbar in:",
    empty: "Keine Funktion entspricht diesem Filter.",
  },
  billingSummary: {
    title: "Abrechnung & Nutzung",
    description: "Verwalten Sie Ihr Abonnement und Ihre Kontingente.",
    subscription: "Abonnement",
    currentCycleUsage: "Nutzung im aktuellen Zyklus",
    statusActive: "Aktiv",
    statusExpired: "Abgelaufen",
    statusNotStarted: "Noch nicht gestartet",
    renewsOn: (isoDate) => `Verlängert sich am ${formatKaitenDate(isoDate, { locale: "de-DE" })}`,
    expiredOn: (isoDate) => `Abgelaufen am ${formatKaitenDate(isoDate, { locale: "de-DE" })}`,
    startsOn: (isoDate) => `Beginnt am ${formatKaitenDate(isoDate, { locale: "de-DE" })}`,
    manageBilling: "Abrechnung verwalten",
    viewInvoices: "Rechnungen ansehen",
    upgrade: "Abonnement upgraden",
    quotaWarning: (name, percentage) => `${name} liegt bei ${percentage} % des Limits.`,
    noUsage: "Kein gemessenes Kontingent in diesem Tarif.",
  },
  customerPortal: {
    currentPlan: "Aktueller Tarif",
    includedFeatures: "Enthaltene Funktionen",
    usageMeters: "Nutzungsanzeigen",
    addOns: "Zusatzoptionen",
    featureFlags: "Feature-Flags",
  },
  currentPlan: {
    title: "Aktueller Tarif",
    renewsOn: (date) => `Verlängerung am ${formatKaitenDate(date, { locale: "de-DE" })}`,
    credits: "Guthaben",
    upgradeVersion: "Tarif wechseln",
    addQuota: "Kontingent hinzufügen",
    addAddOns: "Zusatzoption hinzufügen",
  },
  includedFeatures: {
    title: "Enthaltene Funktionen",
    feature: "Funktion",
    usage: "Nutzung",
    limit: "Limit",
    status: "Status",
    enabled: "Aktiviert",
    disabled: "Deaktiviert",
    nearLimit: "Nahe am Limit",
    overLimit: "Limit überschritten",
    config: "Konfiguration",
    unavailable: "—",
    unlimited: "Unbegrenzt",
    unlimitedGroup: (count) =>
      pluralize(count, {
        one: "1 unbegrenzte Funktion",
        other: "{n} unbegrenzte Funktionen",
      }),
    rowSummary: (name, usage, limit, status) => `${name}: ${usage} von ${limit}, ${status}.`,
  },
  usageMeters: {
    title: "Nutzungsanzeigen",
    currentWindow: (start, end) =>
      `In diesem Zeitraum: ${formatKaitenUsageWindowBound(start, { locale: "de-DE" })} → ${formatKaitenUsageWindowBound(end, { locale: "de-DE" })}`,
    lifetime: "Gesamtzeit",
  },
  addOns: {
    title: "Zusatzoptionen",
    active: "Aktiv",
    available: "Verfügbar",
    remove: "Entfernen",
    add: "Hinzufügen",
    quotaAndCredits: "Kontingent und Guthaben",
  },
  flagsSummary: {
    title: "Feature-Flags",
    runtimeEvaluation: "Auswertung zur Laufzeit",
    rollout: (percentage) =>
      pluralize(percentage, { one: "Rollout zu 1 %", other: "Rollout zu {n} %" }),
    enabled: "Aktiviert",
    disabled: "Deaktiviert",
  },
  paywall: {
    limitReached: "Limit erreicht",
    approachingLimit: "Limit bald erreicht",
    featureUnavailable: "Funktion nicht verfügbar",
    notAvailable: "Nicht verfügbar",
    addQuota: "Kontingent hinzufügen",
    addAddOn: "Zusatzoption hinzufügen",
    contactSales: "Vertrieb kontaktieren",
    upgrade: "Upgrade durchführen",
    dismiss: "Schließen",
    flagDisabledDescription:
      "Diese Funktion ist für diesen Kunden derzeit gesperrt. Schalten Sie sie frei, indem Sie den Tarif wechseln oder die zugehörige Zusatzoption aktivieren.",
    errorDescription:
      "Ihr Zugriff konnte im Moment nicht überprüft werden. Bitte versuchen Sie es gleich erneut.",
    usageDescription: (current, limit) => `Sie haben ${current} von ${limit} zulässigen verwendet.`,
  },
  price: {
    perMonth: "/Monat",
    perYear: "/Jahr",
    everyMonths: "alle {n} Monate",
    everyYears: "alle {n} Jahre",
    perUnit: "pro {unit}",
    unit: "Einheit",
  },
  checkoutFlow: {
    title: "Zusammenfassung",
    description: "Überprüfen Sie Ihre Auswahl, bevor Sie fortfahren.",
    plan: "Tarif",
    addOn: "Zusatzoption",
    total: "Gesamt",
    processing: "Wird verarbeitet…",
    proceedToPayment: "Fortfahren",
    cancel: "Abbrechen",
    error: "Abschluss nicht möglich. Bitte versuchen Sie es erneut.",
    intervalShortMonth: "/Monat",
    intervalShortYear: "/Jahr",
    priceLabel: (price, interval) => {
      if (!interval) return price;
      if (interval === "month") return `${price} pro Monat`;
      if (interval === "year") return `${price} pro Jahr`;
      return `${price} pro ${interval}`;
    },
  },
};
