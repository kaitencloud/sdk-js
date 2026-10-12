// What a checkout, or a payment method, does around the provider's hosted setup page:
// where it sends the customer back to, how it finds out they came back, and how it
// remembers what they were doing in between.
//
// Nothing here draws, and nothing here reads the API: it is the browser's half of the
// round trip, kept apart so that the hooks of both flows share one.

/** The query parameter the hosted setup page brings the customer back with: the setup session's id. */
export const SETUP_SESSION_PARAM = "kaiten_setup_session";

/** The name of the popup the setup page opens in, so that a second click reuses it. */
const POPUP_NAME = "kaiten-setup";
const POPUP_FEATURES = "popup=yes,width=520,height=760";
const CHANNEL_NAME = "kaiten:setup-return";
const PENDING_PREFIX = "kaiten:pending:";

/** How long a saved selection outlives the setup page it waits on, and the fallback when no expiry is known. */
const PENDING_GRACE_MS = 10 * 60_000;
const PENDING_FALLBACK_MS = 60 * 60_000;

const hasWindow = () => typeof window !== "undefined";

/**
 * The URL of the page as it is, without any `kaiten_*` parameter and without its fragment.
 *
 * It is what a setup page is given to send the customer back to: the API appends
 * `kaiten_setup_session` to it as a query parameter, which a fragment would swallow, and
 * a parameter of an earlier return would be carried into the next one.
 */
export function currentPageUrl(): string {
  if (!hasWindow()) return "";
  const url = new URL(window.location.href);
  for (const name of Array.from(url.searchParams.keys())) {
    if (name.startsWith("kaiten_")) url.searchParams.delete(name);
  }
  url.hash = "";
  return url.toString();
}

/**
 * Whether an address is one a page can be sent to: `http:` or `https:`. The provider's pages
 * come from the API, and a `javascript:` or `data:` address from anywhere is not one.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Sends this page to the provider's, by `navigate` or `location.assign`, once the address is checked. */
export function sendPageTo(url: string, navigate?: (url: string) => void): void {
  if (!isHttpUrl(url)) throw new Error("Kaiten: the provider's page is not an http(s) address.");
  (navigate ?? ((target: string) => window.location.assign(target)))(url);
}

/** The setup session this page was loaded back with, or `null`. Reads the address, changes nothing. */
export function readSetupReturn(): string | null {
  if (!hasWindow()) return null;
  return new URL(window.location.href).searchParams.get(SETUP_SESSION_PARAM) || null;
}

/**
 * Takes every `kaiten_*` parameter out of the address bar, and nothing else: the other
 * parameters, the fragment and the history entry stay. Called once a return has been
 * handled, so that a reload does not handle it again.
 */
export function clearKaitenParams(): void {
  if (!hasWindow()) return;
  const url = new URL(window.location.href);
  const names = [...url.searchParams.keys()].filter((name) => name.startsWith("kaiten_"));
  if (names.length === 0) return;
  for (const name of names) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}

// ---------------------------------------------------------------------------
// What the customer was doing, kept while they are on the provider's page
// ---------------------------------------------------------------------------

/** The two flows that send a customer to a setup page. */
export type PendingKind = "checkout" | "payment-method";

interface PendingRecord {
  sessionId: string;
  expiresAt: number;
  data: unknown;
}

/**
 * Keeps what a flow needs to carry on when the customer is back, under the setup
 * session's id. Per tab and per origin (`sessionStorage`), and gone once it is
 * handled, once the setup page has expired, or when the tab closes. Storage that
 * refuses (a private window, a full quota) loses the memory and nothing else.
 */
export function savePending(
  kind: PendingKind,
  sessionId: string,
  data: unknown,
  expiresAt?: string | null,
): void {
  if (!hasWindow()) return;
  const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const record: PendingRecord = {
    sessionId,
    expiresAt: Number.isFinite(parsed)
      ? parsed + PENDING_GRACE_MS
      : Date.now() + PENDING_FALLBACK_MS,
    data,
  };
  try {
    window.sessionStorage.setItem(PENDING_PREFIX + kind, JSON.stringify(record));
  } catch {
    // The flow works without it: only a full-page return loses what was chosen.
  }
}

/** What `savePending` kept for this setup session, or `null`: nothing kept, another session's, or expired. */
export function readPending<T>(kind: PendingKind, sessionId: string): T | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_PREFIX + kind);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<PendingRecord> | null;
    if (!record || record.sessionId !== sessionId) return null;
    if (typeof record.expiresAt !== "number" || record.expiresAt < Date.now()) {
      clearPending(kind);
      return null;
    }
    return (record.data ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Forgets what `savePending` kept for `kind`. */
export function clearPending(kind: PendingKind): void {
  if (!hasWindow()) return;
  try {
    window.sessionStorage.removeItem(PENDING_PREFIX + kind);
  } catch {
    // Nothing to forget.
  }
}

// ---------------------------------------------------------------------------
// Sending the customer to the page, and hearing that they are back
// ---------------------------------------------------------------------------

/** How the setup page was opened: in a popup beside the page, or in place of it. */
export type SetupPageOpening = "popup" | "redirect";

/**
 * Opens the provider's setup page: in a popup when the browser allows one, so that the
 * customer's selection stays on screen, and by sending the page itself there when it
 * does not. `navigate` is what sends it: `location.assign` unless the host says otherwise.
 *
 * The popup is cut off from the page that opened it at once: the provider's page is
 * another origin's, and has no business holding a handle on this one. The two talk
 * through {@link waitForReturn} and {@link announceReturn}, which need none.
 */
export function openSetupPage(url: string, navigate?: (url: string) => void): SetupPageOpening {
  if (!isHttpUrl(url)) throw new Error("Kaiten: the provider's page is not an http(s) address.");
  const popup = window.open(url, POPUP_NAME, POPUP_FEATURES);
  if (popup) {
    try {
      popup.opener = null;
    } catch {
      // A browser that forbids it has already cut the popup off.
    }
    return "popup";
  }
  sendPageTo(url, navigate);
  return "redirect";
}

interface ReturnMessage {
  kaiten: "setup-returned" | "setup-acknowledged";
  sessionId: string;
}

const isReturnMessage = (value: unknown): value is ReturnMessage =>
  typeof value === "object" &&
  value !== null &&
  "kaiten" in value &&
  "sessionId" in value &&
  typeof value.sessionId === "string";

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
}

/**
 * From the window that sent the customer to the setup page: calls `onReturn` when the page
 * the customer comes back to says it is back, and tells it that someone was waiting.
 * Returns what stops the listening.
 */
export function waitForReturn(sessionId: string, onReturn: () => void): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  let returned = false;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isReturnMessage(message) || message.kaiten !== "setup-returned") return;
    if (message.sessionId !== sessionId) return;
    // Every page that says it is back is told so, but the customer is back once.
    channel.postMessage({ kaiten: "setup-acknowledged", sessionId } satisfies ReturnMessage);
    if (returned) return;
    returned = true;
    onReturn();
  };
  return () => channel.close();
}

/**
 * From the page the customer comes back to: says that it is back, and resolves to whether a
 * window that sent them away was waiting. When one was, it carries on and this page has
 * nothing left to do; when none was (the page itself was sent away) this page carries on.
 */
export function announceReturn(sessionId: string, timeoutMs = 300): Promise<boolean> {
  const channel = openChannel();
  if (!channel) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (acknowledged: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(acknowledged);
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (isReturnMessage(message) && message.kaiten === "setup-acknowledged") {
        if (message.sessionId === sessionId) finish(true);
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    channel.postMessage({ kaiten: "setup-returned", sessionId } satisfies ReturnMessage);
  });
}
