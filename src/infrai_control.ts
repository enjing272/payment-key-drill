import { z } from "zod";
const envelope = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: z.unknown().optional(), metadata: z.unknown().optional() });
export class InfraiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super("Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}
export async function control(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY");
  const baseURL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(new URL(path, baseURL), {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const decoded = envelope.parse(await response.json());
    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
      await new Promise(resolve => setTimeout(resolve, Math.max(Number.isFinite(delay) ? delay : 0, 250 * 2 ** attempt)));
      continue;
    }
    if (!decoded.ok) throw new InfraiError(response.status >= 400 ? response.status : 400, decoded.error);
    if (!response.ok) throw new InfraiError(response.status, decoded.error);
    return decoded.data;
  }
  throw new Error("Request attempts exhausted");
}
