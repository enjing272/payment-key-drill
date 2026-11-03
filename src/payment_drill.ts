import { createServer } from "node:http";
import { z } from "zod";
import { control, InfraiError } from "./infrai_control.ts";
import { paymentDecision } from "./payment_policy.ts";
const payment = z.object({ paymentId: z.string().min(1), amountCents: z.number().int().positive(), kind: z.enum(["authorization", "refund"]) }).strict();
const input = z.object({ drillId: z.string().uuid(), temporaryKeyId: z.string().min(1), event: payment }).strict();
const confirm = z.object({ drillId: z.string().uuid(), replacementStored: z.literal(true), inventoryReviewed: z.literal(true), logsReviewed: z.literal(true) }).strict();
type Incident = { input: z.infer<typeof input>; confirmed: boolean; evidence: unknown };
const incidents = new Map<string, Incident>();
const operations = new Map<string, { signature: string; result: Promise<unknown> }>();
function once(id: string, signature: string, run: () => Promise<unknown>) {
  const previous = operations.get(id);
  if (previous) {
    if (previous.signature !== signature) throw new InfraiError(409, "Drill ID already has another request");
    return previous.result;
  }
  const result = run();
  operations.set(id, { signature, result });
  return result;
}
createServer(async (req, res) => {
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.method !== "POST") return send(405, { error: "Use POST" });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
      if (Buffer.byteLength(raw) > 16384) return send(413, { error: "Body too large" });
    }
    const body: unknown = JSON.parse(raw);
    if (req.url === "/temporary-key") {
      const request = z.object({ drillId: z.string().uuid() }).strict().parse(body);
      return send(200, await once(`create:${request.drillId}`, request.drillId, () => control("POST", "/v1/account/keys/create", { name: "payment incident rehearsal", idempotency_key: request.drillId })));
    }
    if (req.url === "/drill") {
      const request = input.parse(body);
      if (!process.env.INFRAI_ACTIVE_KEY_ID) throw new Error("Set INFRAI_ACTIVE_KEY_ID");
      if (request.temporaryKeyId === process.env.INFRAI_ACTIVE_KEY_ID) return send(422, { error: "Select the temporary key" });
      if (!operations.has(`create:${request.drillId}`)) return send(409, { error: "Create the temporary key first" });
      return send(200, await once(`drill:${request.drillId}`, JSON.stringify(request), async () => {
        await operations.get(`create:${request.drillId}`)!.result;
        const id = encodeURIComponent(request.temporaryKeyId);
        const report = await control("POST", `/v1/account/keys/suspected_compromise/${id}`, { confirmed_leak: true, auto_rotate: false });
        const rotation = await control("POST", `/v1/account/keys/rotate/${id}`, { grace_hours: 0, idempotency_key: request.drillId });
        const inventory = await control("GET", "/v1/account/keys/list");
        const logs = await control("GET", "/v1/logs/search");
        const evidence = { report, rotation, inventory, logs };
        incidents.set(request.drillId, { input: request, confirmed: false, evidence });
        return { state: "awaiting_confirmation", notification: { drillId: request.drillId, at: new Date().toISOString(), message: "Report and rotation recorded; review account logs and inventory" }, payment: paymentDecision(request.event, false), evidence };
      }));
    }
    if (req.url === "/confirm") {
      const request = confirm.parse(body);
      const incident = incidents.get(request.drillId);
      if (!incident) return send(404, { error: "Complete the drill first" });
      incident.confirmed = true;
      return send(200, { state: "confirmed", notification: { drillId: request.drillId, message: "Operator confirmed replacement storage, inventory and blast-radius review" }, payment: paymentDecision(incident.input.event, incident.confirmed) });
    }
    send(404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return send(400, { error: "Invalid request body" });
    if (error instanceof InfraiError) return send(error.status, { error: error.detail });
    send(502, { error: "Drill did not complete; inspect the local configuration and retry with the same drill ID" });
  }
}).listen(3000, "127.0.0.1", () => console.log("Payment drill listening on http://127.0.0.1:3000"));
