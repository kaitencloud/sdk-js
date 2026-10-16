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
    quotaInAllowance: (name) =>
      `${name} liegt über der enthaltenen Menge, aber innerhalb der Toleranz.`,
    quotaAtLimit: (name) => `${name} hat das Limit erreicht.`,
    quotaOverLimit: (name) => `${name} liegt über dem Limit.`,
    usageUnavailable: "Nutzung nicht verfügbar",
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
    inAllowance: "Im Toleranzbereich",
    atLimit: "Limit erreicht",
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
    title: "Bezahlung",
    summary: "Zusammenfassung",
    quantity: (name) => `Menge von ${name}`,
    decrease: (name) => `Eine Einheit ${name} entfernen`,
    increase: (name) => `Eine Einheit ${name} hinzufügen`,
    voucherLabel: "Gutscheincode",
    voucherApply: "Einlösen",
    voucherApplied: "Gutschein angewendet",
    voucherRemove: "Gutschein entfernen",
    voucherInvalid: "Dieser Code kann nicht verwendet werden.",
    rateLimited: "Zu viele Versuche. Versuchen Sie es gleich noch einmal.",
    voucherPending: "Wenden Sie den Code an oder leeren Sie das Feld, um fortzufahren.",
    billingEmail: "E-Mail für die Rechnung",
    billingEmailHint: "Rechnungen werden an diese Adresse gesendet.",
    billingEmailToSubscribe: "Geben Sie Ihre Rechnungs-E-Mail ein, um zu abonnieren.",
    billingEmailFirst: "Geben Sie Ihre Rechnungs-E-Mail ein, um zu sehen, was heute fällig ist.",
    dueToday: "Heute fällig",
    todayAmount: (amount) => `${amount} heute`,
    trialEndsOn: (isoDate) =>
      `Testphase endet am ${formatKaitenDate(isoDate, { locale: "de-DE" })}`,
    choosePrice: "Wählen Sie einen Tarif, um zu sehen, was heute fällig ist.",
    quotaExceeded: (names) =>
      `Ihre Nutzung liegt über dem, was dieser Tarif enthält: ${names}. Wählen Sie einen größeren Tarif oder Zusatzoptionen.`,
    unavailable:
      "Der Zahlungsdienstleister ist gerade nicht erreichbar. Versuchen Sie es gleich erneut.",
    error: "Abschluss nicht möglich. Bitte versuchen Sie es erneut.",
    notSold: "Dieser Tarif kann nicht online gekauft werden.",
    subscribe: "Abonnieren",
    processing: "Wird verarbeitet…",
    cancel: "Abbrechen",
    paymentNote:
      "Ihre Kartendaten werden vom Zahlungsdienstleister verarbeitet. Sie erreichen diese Website nie.",
    awaitingPaymentMethod:
      "Speichern Sie Ihre Zahlungsmethode in dem geöffneten Fenster. Wir machen weiter, sobald Sie zurück sind.",
    reopenSetup: "Seite erneut öffnen",
    setupDone: "Ich habe meine Zahlungsmethode gespeichert",
    setupIncomplete:
      "Wir haben noch keine Zahlungsmethode erhalten. Öffnen Sie die Seite erneut oder prüfen Sie noch einmal.",
    subscribed: "Sie sind abonniert",
    nothingDue: "Heute ist nichts zu zahlen.",
    paymentReceived: "Zahlung eingegangen.",
    receipt: "Beleg ansehen",
    confirmPayment: "Bestätigen Sie Ihre Zahlung, um abzuschließen.",
    completePayment: "Zahlung abschließen",
    waitingForPayment: "Warten auf Ihre Zahlung…",
    paymentStillOpen:
      "Wir haben Ihre Zahlung noch nicht gesehen. Wir prüfen erneut, wenn Sie zu diesem Fenster zurückkehren.",
    paymentFailed: "Sie sind abonniert, aber Ihre Karte wurde abgelehnt.",
    updatePaymentMethod: "Zahlungsmethode aktualisieren",
    paymentMethodUpdated: "Zahlungsmethode aktualisiert.",
    payInvoice: "Rechnung bezahlen",
    alreadySubscribed: "Sie haben bereits ein Abonnement.",
    managePlan: "Abonnement verwalten",
    addOnHeld: (quantity) => `Bereits vorhanden: ${quantity}`,
    periodsLimitedBy: (names) =>
      `Einige Abrechnungszeiträume sind nicht verfügbar, da sie Ihre vorhandenen Zusatzoptionen nicht abrechnen können: ${names}.`,
    addOnNotForPeriod: (names) =>
      `Dieser Abrechnungszeitraum kann Ihre vorhandenen Zusatzoptionen nicht abrechnen: ${names}. Wählen Sie einen anderen.`,
    addOnAlreadyHeld: (names) =>
      `Sie haben bereits ${names}. Die Menge können Sie ändern, sobald Ihr Abonnement begonnen hat.`,
    addOnRefused: (names) => `Dieser Tarif kann ${names} nicht abrechnen.`,
  },
  subscription: {
    trial: "Testphase",
    active: "Aktiv",
    pastDue: "Zahlung fehlgeschlagen",
    canceled: "Gekündigt",
    trialEndsOn: (isoDate) =>
      `Testphase endet am ${formatKaitenDate(isoDate, { locale: "de-DE" })}`,
    endsOn: (isoDate) => `Endet am ${formatKaitenDate(isoDate, { locale: "de-DE" })}`,
    changesOn: (price, isoDate) =>
      `Wechselt am ${formatKaitenDate(isoDate, { locale: "de-DE" })} zu ${price}`,
    pastDueNotice: "Ihre letzte Zahlung ist nicht durchgegangen.",
    canceledNotice: "Ihr Abonnement ist beendet.",
    none: "Es gibt kein Abonnement anzuzeigen.",
    subscribe: "Abonnieren",
  },
  portalBilling: {
    invoices: "Rechnungen",
    noInvoices: "Noch keine Rechnungen.",
    invoicePeriod: (from, to) =>
      `${formatKaitenDate(from, { locale: "de-DE" })} – ${formatKaitenDate(to, { locale: "de-DE" })}`,
    kindActivation: "Aktivierung",
    kindRenewal: "Verlängerung",
    kindFinal: "Schlussrechnung",
    statusManual: "Manuell abgerechnet",
    statusPushed: "Zahlung ausstehend",
    statusPaid: "Bezahlt",
    statusFailed: "Zahlung fehlgeschlagen",
    statusUncollectible: "Abgeschrieben",
    statusVoid: "Storniert",
    pay: "Bezahlen",
    pdf: "PDF",
    loadMore: "Ältere Rechnungen anzeigen",
    cancel: "Abonnement kündigen",
    cancelPrompt: (isoDate) =>
      `Ihr Abonnement endet am ${formatKaitenDate(isoDate, { locale: "de-DE" })}. Bis dahin behalten Sie alles, und Sie können die Kündigung vorher zurücknehmen.`,
    cancelTrialPrompt: "Ihre Testphase endet sofort, und es wird nichts berechnet.",
    cancelConfirm: "Zum Ende des Zeitraums kündigen",
    cancelKeep: "Abonnement behalten",
    reactivate: "Abonnement reaktivieren",
    closingPeriod:
      "Wir schließen Ihren Abrechnungszeitraum ab. Ihre Änderung wird gleich übernommen.",
    stillClosing:
      "Ihr Abrechnungszeitraum wird noch abgeschlossen. Versuchen Sie es in einer Minute erneut.",
    unavailable:
      "Der Zahlungsdienstleister ist gerade nicht erreichbar. Versuchen Sie es gleich erneut.",
    actionFailed: "Das hat nicht funktioniert. Bitte versuchen Sie es erneut.",
    addonQuantity: (name) => `Menge von ${name}`,
    addonLess: (name) => `Eine Einheit ${name} entfernen`,
    addonMore: (name) => `Eine Einheit ${name} hinzufügen`,
    addonUpTo: (max) => `Bis zu ${max}`,
    addonsManage: "Zusatzoptionen verwalten",
    addonsManageNote:
      "Wählen Sie, wie viele Einheiten jeder Zusatzoption Sie möchten. Nichts ändert sich, bevor Sie bestätigen.",
    addonsNone: "Sie haben noch keine Zusatzoptionen.",
    addonsSummary: "Ihre Änderungen",
    addonsNoChange: "Noch keine Änderungen.",
    addonsConfirm: "Änderungen bestätigen",
    addonsCancel: "Abbrechen",
    addonsUpdated: "Ihre Zusatzoptionen wurden aktualisiert.",
    addonBilledFrom: (isoDate) =>
      `Gilt sofort und wird ab Ihrer Verlängerung am ${formatKaitenDate(isoDate, { locale: "de-DE" })} berechnet.`,
    addonLowerFrom: (isoDate) =>
      `Gilt sofort. Ihre Verlängerung am ${formatKaitenDate(isoDate, { locale: "de-DE" })} berechnet die neue Menge, und für den laufenden Zeitraum wird nichts erstattet.`,
    addonRemovedFrom: (isoDate) =>
      `Sofort entfernt. Ihre Verlängerung am ${formatKaitenDate(isoDate, { locale: "de-DE" })} berechnet sie nicht mehr, und für den laufenden Zeitraum wird nichts erstattet.`,
    addonEnding: (isoDate) =>
      `Gilt sofort. Ihr Abonnement endet am ${formatKaitenDate(isoDate, { locale: "de-DE" })} und wird nicht verlängert.`,
    addonBilledFromTrialEnd: (isoDate) =>
      `Gilt sofort und wird ab dem Ende Ihrer Testphase am ${formatKaitenDate(isoDate, { locale: "de-DE" })} berechnet.`,
    addonRemovedInTrial: (isoDate) =>
      `Sofort entfernt. Zum Ende Ihrer Testphase am ${formatKaitenDate(isoDate, { locale: "de-DE" })} wird es nicht berechnet.`,
    addonUnbilled: "Gilt sofort. Ohne Abonnement wird nichts berechnet.",
    addonTrueUpNote:
      "Eine höhere Menge kann auf Ihrer nächsten Rechnung auch für den laufenden Zeitraum berechnet werden, zur höchsten darin gehaltenen Menge.",
    addonRefusedFor: (name, reason) => `${name}: ${reason}`,
    addonNotPublic: "Diese Zusatzoption ist nicht mehr verfügbar.",
    addonCurrencyMismatch:
      "Diese Zusatzoption wird nicht in der Währung Ihres Abonnements angeboten.",
    addonIncompatible:
      "Diese Zusatzoption ist für Ihren Tarif oder dessen Abrechnungszeitraum nicht verfügbar.",
    addonQuantityExceedsMax: "Das ist mehr, als diese Zusatzoption erlaubt.",
    addonOtherVersionAttached: "Ihr Tarif enthält bereits eine andere Version dieser Zusatzoption.",
    addonSubscriptionIncomplete:
      "Ihr Tarif beginnt, sobald Ihre Zahlung bestätigt ist. Danach können Sie Zusatzoptionen ändern.",
    addonInstanceRequired: "Zusatzoptionen können auf dieser Seite nicht geändert werden.",
    vouchers: "Gutschein",
    voucherLabel: "Gutscheincode",
    voucherCheck: "Prüfen",
    voucherInvalid: "Dieser Code kann nicht verwendet werden.",
    voucherAtCheckout: "Wird beim Abschluss angewendet.",
    voucherWait: (seconds) =>
      `Zu viele Versuche. Versuchen Sie es in ${seconds < 90 ? `${seconds} Sekunde${seconds === 1 ? "" : "n"}` : `${Math.ceil(seconds / 60)} Minuten`} erneut.`,
    provenance: "Woraus sich dieses Limit ergibt",
    provenanceBase: "Basis",
    provenanceAddOn: "Zusatzoption",
    provenanceVoucher: "Gutschein",
    provenanceWithAddOns: "mit Zusatzoptionen",
    provenanceUnlimited: "Unbegrenzt mit einem Gutschein",
  },
  paymentMethodCard: {
    title: "Zahlungsmethode",
    none: "Keine Zahlungsmethode gespeichert.",
    card: "Karte",
    expires: (monthYear) => `Gültig bis ${monthYear}`,
    expired: "Abgelaufen",
    failed: "Fehlgeschlagen",
    expiredNotice:
      "Diese Karte ist abgelaufen. Fügen Sie eine neue hinzu, um weiter automatisch zu zahlen.",
    failedNotice: "Ihre letzte Zahlung ist fehlgeschlagen. Aktualisieren Sie Ihre Zahlungsmethode.",
    add: "Zahlungsmethode hinzufügen",
    update: "Zahlungsmethode aktualisieren",
    manage: "Im Abrechnungsportal verwalten",
    opening: "Wird geöffnet…",
    saving: "Ihre Zahlungsmethode wird gespeichert…",
    saved: "Zahlungsmethode aktualisiert.",
    incomplete:
      "Wir haben noch keine Zahlungsmethode erhalten. Fügen Sie eine hinzu oder prüfen Sie noch einmal.",
    unavailable:
      "Der Zahlungsdienstleister ist gerade nicht erreichbar. Versuchen Sie es gleich erneut.",
    error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  },
};
