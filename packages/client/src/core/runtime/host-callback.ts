// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * Calls an observer the host passed (`onAuthError`, `onDegraded`), and keeps what it throws
 * away from the SDK's own result.
 *
 * The host is told about something that already happened: a credential the API refused, a read
 * that fell back to REST. An error in its callback is the host's own bug, so it must neither
 * replace the API's error the caller is about to receive nor fail a read that worked. It is
 * reported on the console rather than swallowed, so the bug stays visible.
 */
export function notifyHost<T>(
  name: string,
  callback: ((info: T) => void) | undefined,
  info: T,
): void {
  if (callback === undefined) return;
  try {
    callback(info);
  } catch (error) {
    console.error(`Kaiten: ${name} threw; the SDK carried on.`, error);
  }
}
