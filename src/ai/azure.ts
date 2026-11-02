import { z } from "zod";
import { createPublicKey } from "node:crypto";
import { AiProviderError, type JsonModel } from "./json-model.js";

/** Operator-pinned pilot transport; never accepts a host/deployment from visitors. */
export const AZURE_PASLA = Object.freeze({
  endpoint: "https://pasla.openai.azure.com/openai/v1/chat/completions",
  deployment: "pasla-chat",
  model: "gpt-5-mini-2025-08-07",
  identity: "azure:pasla-chat:gpt-5-mini:2025-08-07",
});
// Conservative uncached estimates, not an Azure billing statement or account cap.
const INPUT_USD_PER_TOKEN = 0.25 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 2 / 1_000_000;
const AZURE_COMPARISON_51=Object.freeze({endpoint:AZURE_PASLA.endpoint,deployment:'pasla-compare-51',model:'gpt-5.1-2025-11-13',identity:'azure:pasla-compare-51:gpt-5.1:2025-11-13'});
const Usage = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() });
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function publicPilotPin(value: string): string {
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\s*$/.test(value.trim())) throw new Error("AZURE_PILOT_PUBLIC_PIN");
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    return key.export({ type: "spki", format: "pem" }).toString();
  } catch { throw new Error("AZURE_PILOT_PUBLIC_PIN"); }
}

/** Azure's subset omits these constraints; the original Zod schema still checks the result. */
function azureSchema(node: unknown): unknown {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return node;
  const omitted = new Set(["$schema", "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "patternProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties", "unevaluatedItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems"]);
  const entries = Object.entries(node);
  const hints = entries.filter(([key, value]) => omitted.has(key) && key !== "$schema" && ["number", "boolean", "string"].includes(typeof value));
  const result = Object.fromEntries(entries.filter(([key]) => !omitted.has(key)).map(([key, value]) => {
    if (key === "properties" || key === "$defs") return [key, Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, azureSchema(child)]))];
    if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(key) && Array.isArray(value)) return [key, value.map(azureSchema)];
    return [key, ["items", "additionalProperties", "not"].includes(key) ? azureSchema(value) : value];
  }));
  if (hints.length) result.description = `${typeof result.description === "string" ? result.description + " " : ""}Constraints checked locally after generation: ${JSON.stringify(Object.fromEntries(hints))}.`;
  return result;
}

/** Exact conservative wire bound for the pinned low/4096 chat profile. */
export function azureChatWireBytes(input:{system:string;user:string;schema:z.ZodType}) {
  const body={model:AZURE_PASLA.deployment,reasoning_effort:'low',max_completion_tokens:4096,response_format:{type:'json_schema',json_schema:{name:'pasla_pilot',strict:true,schema:azureSchema(z.toJSONSchema(input.schema))}},messages:[{role:'system',content:input.system},{role:'user',content:input.user}]};
  return Buffer.byteLength(JSON.stringify(body),'utf8')+1024;
}
type AzureModelOptions={apiKey:string;maxUsd:number;maxCalls?:number;maxInputTokens?:number;profile?:'core'|'low-4096'|'low-6144';fetchImpl?:FetchLike};
export function createAzureModel(input:AzureModelOptions){return createPinnedAzureModel(input,AZURE_PASLA,INPUT_USD_PER_TOKEN,OUTPUT_USD_PER_TOKEN);}
/** Explicit operator diagnostic only. No public ticket or visitor selects this
 * profile; its stronger tariff must first be reserved in the shared campaign. */
export function createAzureComparisonModel(input:Omit<AzureModelOptions,'profile'>){
 if(input.maxCalls!==undefined&&(!Number.isInteger(input.maxCalls)||input.maxCalls<1||input.maxCalls>3))throw new Error('AZURE_COMPARISON_CONFIG');
 return createPinnedAzureModel({...input,maxCalls:input.maxCalls??3,profile:'low-4096'},AZURE_COMPARISON_51,1.25/1_000_000,10/1_000_000);
}
/** Public Tanya profile: one GPT-5.1 call per answer with a larger source budget.
 * Prices are conservative configuration for the ledger, not an Azure invoice. */
export const TANYA_PRICE={inputMicroPerToken:1.25,outputMicroPerToken:10};
export function createAzureTanyaModel(input:Omit<AzureModelOptions,'profile'|'maxCalls'>){
 // Token penalaran ikut terhitung; 4096 membuat sekitar 6% jawaban terpotong (eval 2 Nov 2026).
 return createPinnedAzureModel({...input,maxCalls:1,profile:'low-6144'},AZURE_COMPARISON_51,TANYA_PRICE.inputMicroPerToken/1_000_000,TANYA_PRICE.outputMicroPerToken/1_000_000,40000);
}
function createPinnedAzureModel(input:AzureModelOptions,pin:{endpoint:string;deployment:string;model:string;identity:string},inputPrice:number,outputPrice:number,inputCeiling=20000) {
  const maxCalls = input.maxCalls ?? 9;
  const profile = input.profile ?? "core";
  if (!["core", "low-4096", "low-6144"].includes(profile)) throw new Error("AZURE_PILOT_CONFIG");
  const batasKeluaran = profile === "low-6144" ? 6144 : 4096;
  const inputLimit = input.maxInputTokens ?? 20000;
  if (!Number.isInteger(inputLimit) || inputLimit < 1 || inputLimit > inputCeiling) throw new Error("AZURE_PILOT_CONFIG");
  if (!/^[\x21-\x7e]{8,512}$/.test(input.apiKey) || !Number.isFinite(input.maxUsd) || input.maxUsd <= 0 || input.maxUsd > 1 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 9) throw new Error("AZURE_PILOT_CONFIG");
  let calls = 0; let reservedUsd = 0;
  let lastFailure: string | null = null;
  let retryAfterSeconds: number | null = null;
  let validationIssues: Array<{ code: string; path: Array<string | number> }> = [];
  const usage: Array<z.infer<typeof Usage>> = [];
  const doFetch: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const summary = () => ({ transport: "azure-openai", ...pin, profile, maxUsd: input.maxUsd, maxCalls, calls, reservedUsd, lastFailure, retryAfterSeconds, validationIssues: validationIssues.map(row => ({ ...row, path: [...row.path] })), usage: usage.map(row => ({ ...row })), estimatedUsageUsd: usage.reduce((sum, row) => sum + row.prompt_tokens * inputPrice + row.completion_tokens * outputPrice, 0) });
  const model: JsonModel = {
    // OpenAI is the model vendor; the signed model name and trace identify Azure.
    provider: "openai", model: pin.identity + (profile === "core" ? "" : ":" + profile),
    async generate({ system, user, schema, effort, signal, maxOutputTokens }) {
      signal?.throwIfAborted();
      const requestedCap = maxOutputTokens ?? batasKeluaran;
      if (!Number.isInteger(requestedCap) || requestedCap < 1 || requestedCap > batasKeluaran) throw new Error("AZURE_PILOT_OUTPUT_LIMIT");
      // Explicit operator profile for reasoning models; reflected in trace and signed identity.
      const cap = profile === "core" ? requestedCap : batasKeluaran;
      const jsonSchema = azureSchema(z.toJSONSchema(schema));
      const body = JSON.stringify({ model: pin.deployment, reasoning_effort: profile === "core" ? effort : "low", max_completion_tokens: cap, response_format: { type: "json_schema", json_schema: { name: "pasla_pilot", strict: true, schema: jsonSchema } }, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
      const inputUpperBound = Buffer.byteLength(body, "utf8") + 1024;
      if (inputUpperBound > inputLimit) throw new Error("AZURE_PILOT_INPUT_LIMIT");
      const reserve = inputUpperBound * inputPrice + cap * outputPrice;
      if (calls >= maxCalls) throw new Error("AZURE_PILOT_CALL_LIMIT");
      if (reservedUsd + reserve > input.maxUsd) throw new Error("AZURE_PILOT_BUDGET");
      // Reservation precedes network and is retained even for errors/cancellation.
      calls++; reservedUsd += reserve; lastFailure = null; retryAfterSeconds = null; validationIssues = [];
      let response: Response;
      try {
        response = await doFetch(pin.endpoint, { method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000), headers: { "api-key": input.apiKey, "content-type": "application/json" }, body });
      } catch { lastFailure = "NETWORK"; throw new AiProviderError("Azure pilot tidak dapat dihubungi. Tidak ada percobaan ulang otomatis."); }
      if (!response.ok) {
        lastFailure = `HTTP_${response.status}`;
        if(response.status===429){
          const milliseconds=response.headers.get('retry-after-ms'),seconds=response.headers.get('retry-after');
          const wait=milliseconds!==null&&/^\d+(?:\.\d+)?$/.test(milliseconds)?Number(milliseconds)/1000:seconds!==null&&/^\d+(?:\.\d+)?$/.test(seconds)?Number(seconds):seconds!==null?(Date.parse(seconds)-Date.now())/1000:NaN;
          // Invalid/missing hints use a conservative minute. No provider body is logged.
          retryAfterSeconds=Number.isFinite(wait)&&wait>0?Math.min(86400,Math.ceil(wait)):60;
        }
        await response.body?.cancel().catch(() => undefined);
        throw new AiProviderError(`Azure pilot menolak permintaan (HTTP ${response.status}). Tidak ada percobaan ulang otomatis.`);
      }
      let failureCode = "RESPONSE_INVALID";
      try {
        if (!response.body) throw new Error();
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength;
            if (size > 1_000_000) { await reader.cancel(); throw new Error(); }
            chunks.push(next.value);
          }
        } finally { reader.releaseLock(); }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const measured = Usage.parse(data.usage); usage.push(measured);
        if (data.model !== pin.model) { failureCode = "MODEL_DRIFT"; throw new Error(); }
        if (measured.prompt_tokens > inputUpperBound || measured.completion_tokens > cap) throw new Error();
        if (data.choices?.length !== 1 || data.choices[0].finish_reason !== "stop" || typeof data.choices[0].message?.content !== "string") { failureCode = data.choices?.[0]?.finish_reason === "length" ? "OUTPUT_LENGTH" : "CHOICE_INVALID"; throw new Error(); }
        failureCode = "CONTENT_JSON";
        const parsed: unknown = JSON.parse(data.choices[0].message.content);
        failureCode = "LOCAL_SCHEMA";
        const validated = schema.safeParse(parsed);
        if (!validated.success) {
          const knownFields = new Set(["isu", "subpertanyaan", "penelusuran", "kueri", "sumber", "kriteria", "masukkan", "keluarkan", "sertakanHistoris", "bagian", "judul", "fokus", "pilihan", "id", "keputusan", "alasan", "potonganId", "kutipan", "kalimat", "teks", "lapisan", "potongan_id", "analisis", "merujuk", "queries", "focus", "needsContext", "blocks", "kind", "text", "citations", "passageId", "quote", "questions", "limits", "verdicts", "supported", "reason", "questionsSafe", "limitsSafe", "witnesses", "element", "claimSpan", "quoteSpan"]);
          validationIssues = validated.error.issues.slice(0, 12).map(issue => ({ code: issue.code, path: issue.path.slice(0, 8).map(part => typeof part === "number" ? part : typeof part === "string" && knownFields.has(part) ? part : "[field]") }));
          throw new Error();
        }
        return validated.data;
      } catch { lastFailure = failureCode; throw new AiProviderError("Hasil Azure pilot tidak lengkap, model berubah, atau JSON tidak sah. Tidak ada percobaan ulang otomatis."); }
    },
  };
  return { model, summary };
}
