import * as React from "react";

import { useKaitenScopeKey } from "@kaitencloud/react/internal";

// The add-ons panel opens from two places, the plan card and the add-ons card, and both say once
// the changes made in it went through. What they say is one state for the provider's scope: which
// of them opened the panel, and which of them made the last changes. Two cards side by side then
// never both say the changes went through, and a card whose add-ons all went keeps its panel and
// its sentence on screen until they are done with.

interface PanelState {
  /** The entry point whose panel is open. */
  open: string | null;
  /** The entry point whose changes went through last, which says so. */
  updated: string | null;
}

interface PanelStore {
  get: () => PanelState;
  set: (next: PanelState) => void;
  subscribe: (listener: () => void) => () => void;
}

const CLOSED: PanelState = { open: null, updated: null };

function createStore(): PanelStore {
  let state = CLOSED;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** One store per provider scope, for as long as the page lives: a scope is a provider, and few. */
const stores = new Map<string, PanelStore>();

function storeOf(scope: string): PanelStore {
  let store = stores.get(scope);
  if (!store) {
    store = createStore();
    stores.set(scope, store);
  }
  return store;
}

/** An entry point into the add-ons panel, and what it shows. */
export interface AddOnsPanel {
  /** Its panel is open. */
  open: boolean;
  /** Its changes went through last: it says so, until a panel opens again. */
  updated: boolean;
  /** It has something on screen: its panel, or its sentence. */
  active: boolean;
  /** Opens its panel, and takes the sentence of the last changes off every entry point. */
  show: () => void;
  /** Closes its panel; `done` when every change went through, which it then says. */
  hide: (done: boolean) => void;
}

/**
 * The state of one entry point into the add-ons panel, shared with the others of the provider's
 * scope. The component that renders the entry point holds it, so that it knows to stay on screen
 * while its panel is open or its sentence is said, whatever the add-ons have become.
 */
export function useAddOnsPanel(): AddOnsPanel {
  const id = React.useId();
  const scope = useKaitenScopeKey() ?? "";
  const store = storeOf(scope);
  const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);

  // An entry point that goes away takes its panel and its sentence with it: another one mounted in
  // its place must not find them.
  React.useEffect(
    () => () => {
      const current = store.get();
      if (current.open === id || current.updated === id) {
        store.set({
          open: current.open === id ? null : current.open,
          updated: current.updated === id ? null : current.updated,
        });
      }
    },
    [store, id],
  );

  const show = React.useCallback(() => store.set({ open: id, updated: null }), [store, id]);
  const hide = React.useCallback(
    (done: boolean) => {
      const current = store.get();
      store.set({
        open: current.open === id ? null : current.open,
        updated: done ? id : current.updated === id ? null : current.updated,
      });
    },
    [store, id],
  );

  const open = state.open === id;
  const updated = state.updated === id;
  return { open, updated, active: open || updated, show, hide };
}
