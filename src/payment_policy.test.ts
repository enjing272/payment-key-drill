import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentDecision } from "./payment_policy.ts";
test("a refund stays held until credential review and still requires payment review", () => {
  const refund = { paymentId: "refund-17", amountCents: 500, kind: "refund" as const };
  assert.deepEqual(paymentDecision(refund, false), { paymentId: "refund-17", action: "hold", reason: "Credential incident remains open", risk: "elevated" });
  assert.equal(paymentDecision(refund, true).action, "release_for_review");
  assert.equal(paymentDecision(refund, true).risk, "elevated");
});
