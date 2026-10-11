import { describe, expect, test } from "vite-plus/test";

import { mapVoucherValidation } from "../src/client/session-mapping.ts";

describe("vouchers", () => {
  test("a voucher check: a refusal says nothing, a discount carries its currency code", () => {
    expect(mapVoucherValidation({ valid: false })).toEqual({ valid: false });
    expect(
      mapVoucherValidation({
        valid: true,
        voucher: {
          name: "Welcome 20%",
          voucherType: "PRICE",
          duration: "ONCE",
          durationInPeriods: null,
          discount: { type: "FIXED_AMOUNT", value: 500, currency: "EUR", appliesTo: "BASE" },
        },
      }),
    ).toEqual({
      valid: true,
      voucher: {
        name: "Welcome 20%",
        voucherType: "PRICE",
        duration: "ONCE",
        durationInPeriods: null,
        discount: { type: "FIXED_AMOUNT", value: 500, currencyCode: "EUR", appliesTo: "BASE" },
      },
    });
  });
});
