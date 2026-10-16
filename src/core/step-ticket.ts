import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./sign.js";

const Ticket = z.object({ v: z.literal(1), sub: z.string().min(1).max(100), aud: z.string().url(), reportId: z.string().min(1).max(100), step: z.enum(["rencana", "saring", "sintesis"]), attemptId: z.string().min(1).max(100), inputHash: z.string().regex(/^[a-f0-9]{64}$/), maxInputTokens: z.number().int().min(1).max(20000), maxOutputTokens: z.number().int().min(1).max(4096), jti: z.string().regex(/^[\w-]{43}$/), iat: z.number().int(), exp: z.number().int() });
export const requestHash = (input: unknown) => createHash("sha256").update(canonicalJson(input)).digest("hex");
// Byte UTF-8 membatasi token teks secara konservatif, ditambah ruang prompt/skema.
export const estimatedInputTokens = (input: unknown) => Buffer.byteLength(canonicalJson(input), "utf8") + 5000;
export function createTicketGuard(secret: string, audience: string, clock = () => Math.floor(Date.now() / 1000)) {
  if (secret.length < 43 || !/^https?:\/\//.test(audience)) throw new Error("Konfigurasi tiket langkah tidak sah.");
  const used = new Map<string, number>();
  const accounts = new Map<string, { end: number; count: number }>();
  return (encoded: string, step: string, input: unknown) => {
    const time = clock();
    for (const [id, expires] of used) if (expires <= time) used.delete(id);
    for (const [id, value] of accounts) if (value.end <= time) accounts.delete(id);
    if (encoded.length > 2500 || used.size >= 10000) throw new Error("TICKET_INVALID");
    const parts = encoded.split(".");
    if (parts.length !== 2 || !parts.every((p) => /^[\w-]+$/.test(p))) throw new Error("TICKET_INVALID");
    const expected = createHmac("sha256", secret).update(parts[0]!).digest();
    const supplied = Buffer.from(parts[1]!, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("TICKET_INVALID");
    let raw: unknown;
    try { raw = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")); } catch { throw new Error("TICKET_INVALID"); }
    const parsed = Ticket.safeParse(raw);
    if (!parsed.success) throw new Error("TICKET_INVALID");
    const value = parsed.data;
    if (value.aud !== audience || value.step !== step || value.inputHash !== requestHash(input) || value.exp <= time || value.iat > time + 5 || value.exp - value.iat > 120 || used.has(value.jti) || estimatedInputTokens(input) > value.maxInputTokens || value.maxOutputTokens !== (step === "sintesis" ? 4096 : 2500)) throw new Error("TICKET_INVALID");
    const rate = accounts.get(value.sub) ?? { end: time + 60, count: 0 };
    if (rate.count >= 6 || accounts.size >= 10000 && !accounts.has(value.sub)) throw new Error("ACCOUNT_RATE_LIMIT");
    rate.count++; accounts.set(value.sub, rate); used.set(value.jti, value.exp);
    return value;
  };
}
