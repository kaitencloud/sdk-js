// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// A router small enough to read: the storefront has three pages, and the checkout has to be
// served at a path of its own. The provider's setup page brings the customer back to the page
// they left, with a query parameter, and a route in the fragment would be lost on the way.

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const NAVIGATE = "storefront:navigate";

/** The path of the page, and its query string. */
export function currentLocation(): { path: string; search: URLSearchParams } {
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

/**
 * Goes to another page of the storefront, without loading it again. A page loaded again opens at
 * its top and with the focus at its start, so this does the same: the new page is shown from its
 * title, wherever the link was, and a keyboard or screen-reader user starts at that title. A link
 * to a place in the page (`#section`) keeps what the browser does with it.
 */
export function navigate(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE));
  if (new URL(to, window.location.href).hash) return;
  window.scrollTo(0, 0);
  // The page draws on the event above, and some pages draw their title once they have loaded.
  window.requestAnimationFrame(() => {
    const title = document.querySelector<HTMLElement>("main h1");
    if (!title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  });
}

/** The page the address names, followed as it changes. */
export function useLocation() {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE, update);
    };
  }, []);
  return location;
}

/** A link to another page of the storefront. */
export function Link({
  to,
  children,
  ...rest
}: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a {...rest} href={to} onClick={onClick}>
      {children}
    </a>
  );
}
