/** Collection harness, not a quality verdict. Never open answer-key references. */
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BerkasSetSchema } from "../eval/skema.js";
import { evalKeyFingerprint, runV2Flow, type V2FlowPorts } from "../eval/v2-flow.js";
import { canonicalJson } from "../src/core/sign.js";
import { estimatedInputTokens, requestHash } from "../src/core/step-ticket.js";
import { AiModelNameSchema, AiProviderIdSchema } from "../src/ai/json-model.js";
import type { HasilBuka } from "../src/core/sumber.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]!;
  if (!key.startsWith("--")) throw new Error("EVAL_ARGUMENT");
  const next = process.argv[index + 1];
  args.set(key.slice(2), next && !next.startsWith("--") ? (index++, next) : "1");
}
const allowedArgs = new Set(["api", "rumpun", "limit", "putaran", "max-paid-steps", "run"]);
if ([...args.keys()].some(key => !allowedArgs.has(key))) throw new Error("EVAL_ARGUMENT_HELD_OUT_DISABLED");
const integer = (key: string, fallback: number, max: number) => {
  const value = Number(args.get(key) ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error("EVAL_ARGUMENT");
  return value;
};
const limit = integer("limit", 1, 180);
const runs = integer("putaran", 3, 3);
if (runs !== 3) throw new Error("EVAL_THREE_RUNS_REQUIRED");
const root = path.resolve(import.meta.dirname, "..", "eval");
const cases = [];
for (const name of (await readdir(path.join(root, "rumpun"))).filter(name => name.endsWith(".json")).sort()) {
  const dataset = BerkasSetSchema.parse(JSON.parse(await readFile(path.join(root, "rumpun", name), "utf8")));
  // Held-out content is never passed to the flow, logged, or placed in output.
  cases.push(...dataset.butir.filter(item => !item.tertahan && (!args.has("rumpun") || item.rumpun === args.get("rumpun"))));
}
const selectedCases = cases.slice(0, limit);
const blockers = ["Frozen source snapshot not remotely attested", "Temperature zero not enforced by the current API", "Independent calibrated judge and human labels pending", "Discovery/recall and legal correctness must be scored separately after collection"];
if (!args.has("run")) {
  console.log(JSON.stringify({ mode: "preflight", cases: selectedCases.length, runs, heldOutUsed: false, paidCalls: 0, qualityGatePassed: false, blockers }));
} else {
  const base = new URL(args.get("api") ?? "http://127.0.0.1:3102");
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("EVAL_LOOPBACK_REQUIRED");
  if (process.env.EVAL_CONFIRM_PAID !== "pasla-eval-v2" || !args.has("max-paid-steps")) throw new Error("EVAL_PAID_AUTHORIZATION_REQUIRED");
  const maxPaidSteps = integer("max-paid-steps", 0, 10000);
  const provider = AiProviderIdSchema.parse(process.env.EVAL_AI_PROVIDER);
  const model = AiModelNameSchema.parse(process.env.EVAL_AI_MODEL);
  if (!/(?:20\d{6}|20\d{2}-\d{2}-\d{2})/.test(model)) throw new Error("EVAL_DATED_MODEL_REQUIRED");
  const key = process.env.EVAL_AI_KEY;
  const secret = process.env.EVAL_STEP_TICKET_SECRET;
  const pinFile = process.env.EVAL_PUBLIC_KEY_FILE;
  if (!key || !/^[\x21-\x7e]{8,512}$/.test(key) || !secret || secret.length < 43 || !pinFile || !selectedCases.length) throw new Error("EVAL_CONFIGURATION");
  const pin = await readFile(pinFile, "utf8");
  const publicKeySha256 = evalKeyFingerprint(pin);
  if (!publicKeySha256) throw new Error("EVAL_PIN_REQUIRED");
  const advertised = await fetch(new URL("/v2/kunci-publik", base), { redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!advertised.ok || !(await advertised.json() as { data?: { kunci?: string[] } }).data?.kunci?.some(key => evalKeyFingerprint(key) === publicKeySha256)) throw new Error("EVAL_PIN_MISMATCH");
  const audience = process.env.EVAL_TICKET_AUDIENCE ?? base.origin;
  let paidSteps = 0;
  let owner = "";
  let ownerWindow = 0;
  let ownerSteps = 0;
  const request = async (route: string, input: unknown, paid = false): Promise<unknown> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (paid) {
      if (paidSteps >= maxPaidSteps) throw new Error("EVAL_PAID_STEP_LIMIT");
      if (estimatedInputTokens(input) > 20000) throw new Error("EVAL_INPUT_BUDGET");
      if (ownerSteps >= 6) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 61100 - (Date.now() - ownerWindow))));
        ownerSteps = 0; ownerWindow = Date.now();
      }
      const step = route.split("/").at(-1)!;
      const now = Math.floor(Date.now() / 1000);
      const payload = { v: 1, sub: owner, aud: audience, reportId: owner, step, attemptId: owner, inputHash: requestHash(input), maxInputTokens: 20000, maxOutputTokens: step === "sintesis" ? 4096 : 2500, jti: randomBytes(32).toString("base64url"), iat: now, exp: now + 120 };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      headers["x-pasla-step-ticket"] = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
      headers["x-pasla-ai-provider"] = provider;
      headers["x-pasla-ai-model"] = model;
      headers["x-pasla-ai-key"] = key;
      paidSteps++;
      ownerSteps++;
    }
    const response = await fetch(new URL(route, base), { method: "POST", headers, body: canonicalJson(input), redirect: "error", signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`EVAL_HTTP_${response.status}`);
    if (!response.body) throw new Error("EVAL_RESPONSE");
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.byteLength; if (size > 4 * 1024 * 1024) throw new Error("EVAL_RESPONSE_SIZE"); chunks.push(chunk); }
    const text = Buffer.concat(chunks, size).toString("utf8");
    if (!paid) return (JSON.parse(text) as { data: unknown }).data;
    const events = text.trim().split("\n").map(line => JSON.parse(line) as { jenis: string; data?: unknown });
    const results = events.filter(event => event.jenis === "hasil");
    if (results.length !== 1 || events.some(event => event.jenis === "galat")) throw new Error("EVAL_AI_FAILED");
    return results[0]!.data;
  };
  const ports: V2FlowPorts = {
    plan: input => request("/v2/laporan/rencana", input, true),
    search: input => request("/v2/telusur", input),
    open: async ref => {
      const rows = await request("/v2/sumber/potongan", { rujukan: [ref] }) as HasilBuka[];
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error("EVAL_OPEN_RESULT");
      return rows[0]!;
    },
    screen: input => request("/v2/laporan/saring", input, true),
    synthesize: input => request("/v2/laporan/sintesis", input, true),
  };
  const rows: unknown[] = [];
  for (let run = 1; run <= runs; run++) for (const item of selectedCases) {
    owner = `eval-${randomBytes(12).toString("hex")}`;
    ownerWindow = Date.now(); ownerSteps = 0;
    try {
      const trace = await runV2Flow({ pertanyaan: item.pertanyaan, rumpun: item.rumpun }, ports, [pin]);
      rows.push({ id: item.id, run, trace });
    } catch (cause) {
      const code = cause instanceof Error && /^EVAL_[A-Z0-9_]+$/.test(cause.message) ? cause.message : "EVAL_FAILED";
      rows.push({ id: item.id, run, error: code });
      if (code === "EVAL_PAID_STEP_LIMIT") break;
    }
  }
  const at = new Date().toISOString();
  const output = { at, provider, model, publicKeySha256, paidSteps, maxPaidSteps, heldOutUsed: false, qualityGatePassed: false, blockers, rows };
  const directory = path.join(root, "hasil"); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `v2-${at.replaceAll(/[:.]/g, "-")}.json`), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ mode: "collection", cases: rows.length, paidSteps, qualityGatePassed: false, blockers }));
}
