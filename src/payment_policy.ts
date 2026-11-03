export type PaymentEvent = { paymentId: string; amountCents: number; kind: "authorization" | "refund" };
export function paymentDecision(event: PaymentEvent, confirmed: boolean) {
  return {
    paymentId: event.paymentId,
    action: confirmed ? "release_for_review" : "hold",
    reason: confirmed ? "Credential replaced; human payment review required" : "Credential incident remains open",
    risk: event.kind === "refund" || event.amountCents >= 100000 ? "elevated" : "standard",
  };
}
