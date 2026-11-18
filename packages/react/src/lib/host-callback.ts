// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * Calls a callback the host passed, and keeps what it throws away from the SDK's own outcome.
 *
 * The host is told about something that already happened: a checkout that completed, a
 * session that opened, a call that succeeded or failed. An error in its callback is the host's
 * own bug, not the outcome's, so it must neither turn a success into a failure nor stand in for
 * the error the call came to. It is reported on the console rather than swallowed, so the bug
 * stays visible.
 */
export function notifyHost<Args extends unknown[]>(
  name: string,
  callback: ((...args: Args) => void) | undefined,
  ...args: Args
): void {
  if (callback === undefined) return;
  try {
    callback(...args);
  } catch (error) {
    console.error(`[@kaitencloud/react] ${name} threw; the SDK carried on.`, error);
  }
}
