// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What a visitor types to sign up, and what makes it acceptable. Shared by the form, which checks it
// before it asks (`pages/sign-up-step.tsx`), and by the route, which checks it again before it sends
// anything to Kaiten (`server/account-routes.ts`): a request does not have to come from the form.

/** The longest a name or an e-mail address can be: the contract allows 254 to an address. */
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

/** What is wrong with each field, in a word; a field that is fine is not in it. */
export interface SignUpFields {
  name?: "required" | "too_long";
  email?: "required" | "invalid" | "too_long";
}

/** A light check of an address: something, an @, something, a dot, something. Kaiten's is the one that counts. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The name and the e-mail address, trimmed, or what is wrong with them. */
export function checkSignUp(
  given: unknown,
): { ok: true; name: string; email: string } | { ok: false; fields: SignUpFields } {
  const body =
    typeof given === "object" && given !== null ? (given as Record<string, unknown>) : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const fields: SignUpFields = {};
  if (name === "") fields.name = "required";
  else if (name.length > NAME_MAX) fields.name = "too_long";
  if (email === "") fields.email = "required";
  else if (email.length > EMAIL_MAX) fields.email = "too_long";
  else if (!EMAIL.test(email)) fields.email = "invalid";
  return fields.name || fields.email ? { ok: false, fields } : { ok: true, name, email };
}

/** The sentence under a field for what is wrong with it. */
export const FIELD_MESSAGES: {
  [K in keyof SignUpFields]-?: Record<NonNullable<SignUpFields[K]>, string>;
} = {
  name: {
    required: "Enter your name, or your company's.",
    too_long: `Use ${NAME_MAX} characters or fewer.`,
  },
  email: {
    required: "Enter an e-mail address.",
    invalid: "Enter an address like name@company.com.",
    too_long: `Use ${EMAIL_MAX} characters or fewer.`,
  },
};
