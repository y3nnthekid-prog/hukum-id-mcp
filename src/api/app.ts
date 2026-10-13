import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { AiProviderError } from "../ai/gemini.js";
import { synthesizeEvidenceFirst, type EvidenceSynthesisProvider } from "../ai/evidence-synthesis.js";
import { AiModelNameSchema, AiProviderIdSchema, type AiProviderId, type JsonModel } from "../ai/json-model.js";
import type { AskFunction } from "../core/ask.js";
import { type Evidence } from "../core/contracts.js";
import type { LegalResearchService, SearchSource } from "../core/service.js";
import { observeApiRequest } from "../telemetry.js";
import { HUKUM_ID_VERSION } from "../version.js";

type ApiEnv = { Variables: { traceId: string; userId: string | null } };

export interface UploadStore {
  createUpload(input: {
    fileName: string;
    contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    sizeBytes: number;
    classification: "public" | "internal" | "confidential";
    aiConsent: boolean;
    ownerId: string;
    idempotencyKey: string;
  }): Promise<unknown>;
  putUpload(input: {
    id: string;
    ownerId: string;
    contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    bytes: Uint8Array;
  }): Promise<unknown>;
}

export interface JobStore {
  getJob(id: string, ownerId: string): Promise<unknown | null>;
}

type ApiDependencies = {
  service: LegalResearchService;
  uploadStore?: UploadStore;
  jobStore?: JobStore;
  allowedOrigins?: string[];
  authenticate?: (authorization: string | undefined) => Promise<string | null>;
  makeAiProvider?: (ephemeralApiKey: string | undefined) => EvidenceSynthesisProvider | null;
  resolveEvidence?: (evidenceIds: string[], ownerId: string) => Promise<Evidence[]>;
  ask?: AskFunction;
  resolveAiModel?: (selection: AiModelSelection) => ResolvedAiModel;
  /** Batas pertanyaan per hari per klien yang memakai kunci AI platform. */
  platformAiDailyLimit?: number;
  /** Batas konkurensi /v1/ask agar lonjakan pengguna tidak menumpuk beban ke situs sumber. */
  askConcurrency?: { active: number; queued: number };
  /** Percayai header CF-Connecting-IP; aktifkan hanya bila server di belakang Cloudflare Tunnel. */
  trustCloudflareIp?: boolean;
};

export type AiModelSelection = {
  provider?: AiProviderId | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
};

export type ResolvedAiModel =
  | { model: JsonModel | null; platform: boolean }
  | { error: "PROVIDER_REQUIRED" | "MODEL_REQUIRED" | "PROVIDER_UNSUPPORTED" };

const AskSchema = z.object({
  question: z.string().trim().min(4).max(2_000),
  useAi: z.boolean().default(true),
});

// Kunci BYOK: karakter ASCII terlihat saja, tanpa spasi. Nilainya tidak pernah dipantulkan.
const ByokKeySchema = z.string().regex(/^[\x21-\x7e]{8,512}$/);

const SearchSourceSchema = z.enum([
  "regulation",
  "ma-product",
  "fatwa",
  "ma-decision",
  "mk-decision",
  "literature",
]);
const DocumentSourceSchema = z.enum(["regulation", "ma-decision"]);
const DocumentRefSchema = z.string().trim().min(1).max(500);
const ArticleRefSchema = z.string().trim().min(3).max(80);
const JobIdSchema = z.string().uuid();

const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(300),
  sources: z.string().optional(),
  number: z.string().trim().max(30).optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
});

const VerifyCitationSchema = z.object({ text: z.string().trim().min(1).max(100_000) });
const ResearchSchema = z.object({
  question: z.string().trim().min(4).max(5_000),
  useAi: z.boolean().default(false),
  evidenceIds: z.array(z.string().regex(/^ev_[a-f0-9]{24}$/)).max(40).default([]),
  documentContext: z.discriminatedUnion("source", [
    z.object({ source: z.literal("corpus") }),
    z.object({ source: z.literal("upload"), uploadId: z.string().uuid() }),
  ]).default({ source: "corpus" }),
});
const TimelineSchema = z.object({
  article: z.string().trim().max(80).optional(),
  asOf: z.string().date().optional(),
});
const UploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180).regex(/\.(pdf|docx)$/i),
  contentType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  classification: z.enum(["public", "internal", "confidential"]),
  aiConsent: z.boolean().default(false),
});

function clientId(c: Context<ApiEnv>, trustCloudflareIp = false): string {
  const identity =
    c.get("userId") ||
    (trustCloudflareIp ? c.req.header("cf-connecting-ip")?.trim() : undefined) ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous";
  return createHash("sha256").update(identity.slice(0, 200)).digest("hex").slice(0, 24);
}

async function readJson(c: Context<ApiEnv>): Promise<unknown> {
  const declared = Number(c.req.header("content-length") || 0);
  if (declared > 150_000) throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return await c.req.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function apiError(c: Context<ApiEnv>, status: 400 | 401 | 404 | 409 | 413 | 422 | 429 | 500 | 503, code: string, message: string, details?: unknown) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        traceId: c.get("traceId"),
      },
    },
    status
  );
}

export function createApiApp({
  service,
  uploadStore,
  jobStore,
  allowedOrigins = [],
  authenticate,
  makeAiProvider,
  resolveEvidence,
  ask,
  resolveAiModel,
  platformAiDailyLimit = 15,
  askConcurrency = { active: 2, queued: 6 },
  trustCloudflareIp = false,
}: ApiDependencies) {
  const app = new Hono<ApiEnv>();
  const counters = new Map<string, { count: number; resetAt: number }>();
  const platformAiUsage = new Map<string, { count: number; resetAt: number }>();
  let lastCounterSweep = 0;

  // Gerbang konkurensi untuk /v1/ask. Satu pertanyaan bisa membuka beberapa
  // dokumen resmi, jadi antrean dibatasi: lebih baik menjawab "sedang ramai"
  // daripada menumpuk permintaan ke situs yang dibiayai anggaran publik.
  let askActive = 0;
  const askWaiting: Array<() => void> = [];
  async function acquireAskSlot(): Promise<boolean> {
    if (askActive < askConcurrency.active) {
      askActive += 1;
      return true;
    }
    if (askWaiting.length >= askConcurrency.queued) return false;
    await new Promise<void>((resolve) => askWaiting.push(resolve));
    askActive += 1;
    return true;
  }
  function releaseAskSlot() {
    askActive -= 1;
    askWaiting.shift()?.();
  }

  app.use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    await observeApiRequest(c.req.method, pathname, next, () => c.res.status);
  });

  app.use("*", async (c, next) => {
    const traceId = randomUUID();
    c.set("traceId", traceId);
    c.set("userId", authenticate ? await authenticate(c.req.header("authorization")) : null);
    c.header("x-trace-id", traceId);
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "no-referrer");
    c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");

    const origin = c.req.header("origin");
    if (origin && allowedOrigins.includes(origin)) {
      c.header("access-control-allow-origin", origin);
      c.header("vary", "Origin");
    }

    const key = clientId(c, trustCloudflareIp);
    const now = Date.now();
    if (now - lastCounterSweep >= 60_000) {
      for (const [candidate, value] of counters) {
        if (value.resetAt <= now) counters.delete(candidate);
      }
      for (const [candidate, value] of platformAiUsage) {
        if (value.resetAt <= now) platformAiUsage.delete(candidate);
      }
      lastCounterSweep = now;
    }
    if (counters.size >= 10_000) counters.delete(counters.keys().next().value!);
    const current = counters.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
    bucket.count += 1;
    counters.set(key, bucket);
    c.header("x-ratelimit-limit", "120");
    c.header("x-ratelimit-remaining", String(Math.max(0, 120 - bucket.count)));
    c.header("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > 120) return apiError(c, 429, "RATE_LIMITED", "Terlalu banyak permintaan. Coba lagi setelah jendela kuota berakhir.");

    await next();
  });

  app.options("*", (c) => {
    c.header("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
    c.header(
      "access-control-allow-headers",
      "authorization,content-type,idempotency-key,x-gemini-api-key,x-pasla-ai-provider,x-pasla-ai-model,x-pasla-ai-key"
    );
    return c.body(null, 204);
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "hukum-id-api", version: HUKUM_ID_VERSION }));

  app.get("/v1/search", async (c) => {
    const parsed = SearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Parameter pencarian tidak sah.", parsed.error.flatten());
    const parsedSources = parsed.data.sources
      ? z.array(SearchSourceSchema).min(1).max(6).safeParse(parsed.data.sources.split(",").map((source) => source.trim()))
      : null;
    if (parsedSources && !parsedSources.success) {
      return apiError(c, 422, "VALIDATION_ERROR", "Daftar sumber pencarian tidak sah.", parsedSources.error.flatten());
    }
    const sources = parsedSources?.data;
    const result = await service.searchLegalSources({
      query: parsed.data.q,
      pageSize: parsed.data.pageSize,
      ...(sources ? { sources: sources as SearchSource[] } : {}),
      ...(parsed.data.number ? { number: parsed.data.number } : {}),
      ...(parsed.data.year ? { year: parsed.data.year } : {}),
    });
    return c.json({ data: result, meta: { traceId: c.get("traceId"), nextCursor: result.nextCursor } });
  });

  app.get("/v1/documents/:id", async (c) => {
    const source = DocumentSourceSchema.safeParse(c.req.query("source") || "regulation");
    const ref = DocumentRefSchema.safeParse(c.req.param("id"));
    if (!source.success || !ref.success) {
      return apiError(c, 422, "VALIDATION_ERROR", "Rujukan dokumen tidak sah.");
    }
    const data = await service.getLegalDocument({ source: source.data, ref: ref.data });
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.get("/v1/documents/:id/articles/:article", async (c) => {
    const regulation = DocumentRefSchema.safeParse(c.req.param("id"));
    const article = ArticleRefSchema.safeParse(c.req.param("article"));
    if (!regulation.success || !article.success) {
      return apiError(c, 422, "VALIDATION_ERROR", "Rujukan peraturan atau pasal tidak sah.");
    }
    const data = await service.lookupArticle({ regulation: regulation.data, article: article.data });
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.get("/v1/documents/:id/timeline", async (c) => {
    const ref = DocumentRefSchema.safeParse(c.req.param("id"));
    if (!ref.success) return apiError(c, 422, "VALIDATION_ERROR", "Rujukan dokumen tidak sah.");
    const parsed = TimelineSchema.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Parameter timeline tidak sah.", parsed.error.flatten());
    const data = await service.traceRegulation({
      regulation: ref.data,
      ...(parsed.data.article ? { article: parsed.data.article } : {}),
      ...(parsed.data.asOf ? { asOf: parsed.data.asOf } : {}),
    });
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.post("/v1/citations/verify", async (c) => {
    const parsed = VerifyCitationSchema.safeParse(await readJson(c));
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Draf sitasi tidak sah.", parsed.error.flatten());
    const data = await service.verifyCitation(parsed.data);
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.post("/v1/research", async (c) => {
    const parsed = ResearchSchema.safeParse(await readJson(c));
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Pertanyaan riset tidak sah.", parsed.error.flatten());
    if (!parsed.data.useAi) {
      const data = await service.analyzeLegalProblem({ question: parsed.data.question });
      return c.json({ data, meta: { traceId: c.get("traceId") } });
    }

    const ownerId = c.get("userId");
    if (!ownerId) return apiError(c, 401, "AUTHENTICATION_REQUIRED", "Akun diperlukan untuk sintesis AI.");
    if (!makeAiProvider || !resolveEvidence) {
      return apiError(c, 503, "AI_NOT_CONFIGURED", "Sintesis AI belum dikonfigurasi pada layanan ini.");
    }
    if (parsed.data.documentContext.source === "upload") {
      const upload = await jobStore?.getJob(parsed.data.documentContext.uploadId, ownerId) as
        | { aiConsent?: boolean; classification?: string }
        | null
        | undefined;
      if (!upload) return apiError(c, 404, "UPLOAD_NOT_FOUND", "Unggahan tidak ditemukan.");
      if (upload.aiConsent !== true) {
        return apiError(
          c,
          422,
          "AI_CONSENT_REQUIRED",
          "Consent khusus per dokumen wajib sebelum evidence unggahan dikirim ke penyedia AI.",
          { classification: upload.classification ?? "unknown" }
        );
      }
    }

    const apiKey = c.req.header("x-gemini-api-key")?.trim();
    if (apiKey && apiKey.length > 512) return apiError(c, 422, "BYOK_INVALID", "Gemini API key tidak sah.");
    const provider = makeAiProvider(apiKey || undefined);
    if (!provider) return apiError(c, 503, "AI_KEY_REQUIRED", "Kuota platform tidak tersedia; gunakan BYOK.");
    const evidence = await resolveEvidence(parsed.data.evidenceIds, ownerId);
    let data;
    try {
      data = await synthesizeEvidenceFirst(
        { question: parsed.data.question, evidence, signal: c.req.raw.signal },
        provider
      );
    } catch (error) {
      if (error instanceof AiProviderError) return apiError(c, 503, "AI_PROVIDER_ERROR", error.message);
      throw error;
    }
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.post("/v1/ask", async (c) => {
    if (!ask) return apiError(c, 503, "ASK_NOT_CONFIGURED", "Layanan tanya belum dikonfigurasi pada server ini.");
    const parsed = AskSchema.safeParse(await readJson(c));
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Pertanyaan tidak sah.", parsed.error.flatten());

    const notes: string[] = [];
    let model: JsonModel | null = null;
    if (parsed.data.useAi && resolveAiModel) {
      const legacyGeminiKey = c.req.header("x-gemini-api-key")?.trim();
      const rawKey = c.req.header("x-pasla-ai-key")?.trim() || legacyGeminiKey || undefined;
      const rawProvider = c.req.header("x-pasla-ai-provider")?.trim() || (legacyGeminiKey ? "gemini" : undefined);
      const rawModel = c.req.header("x-pasla-ai-model")?.trim() || undefined;

      const provider = rawProvider === undefined ? undefined : AiProviderIdSchema.safeParse(rawProvider);
      if (provider && !provider.success) return apiError(c, 422, "AI_PROVIDER_INVALID", "Penyedia AI tidak dikenal.");
      if (rawKey !== undefined && !ByokKeySchema.safeParse(rawKey).success) {
        return apiError(c, 422, "BYOK_INVALID", "Format kunci API tidak sah.");
      }
      if (rawModel !== undefined && !AiModelNameSchema.safeParse(rawModel).success) {
        return apiError(c, 422, "AI_MODEL_INVALID", "Nama model tidak sah.");
      }

      const resolved = resolveAiModel({
        ...(provider?.success ? { provider: provider.data } : {}),
        ...(rawModel ? { model: rawModel } : {}),
        ...(rawKey ? { apiKey: rawKey } : {}),
      });
      if ("error" in resolved) {
        const message = {
          PROVIDER_REQUIRED: "Pilih penyedia AI untuk kunci yang kamu isi.",
          MODEL_REQUIRED: "Penyedia ini membutuhkan nama model.",
          PROVIDER_UNSUPPORTED: "Penyedia AI tidak didukung.",
        }[resolved.error];
        return apiError(c, 422, resolved.error, message);
      }
      if (resolved.platform && resolved.model) {
        const key = clientId(c, trustCloudflareIp);
        const now = Date.now();
        const current = platformAiUsage.get(key);
        const usage = !current || current.resetAt <= now ? { count: 0, resetAt: now + 24 * 60 * 60_000 } : current;
        if (usage.count >= platformAiDailyLimit) {
          notes.push("Kuota penjelasan AI gratis hari ini sudah habis. Isi kunci AI milikmu sendiri untuk lanjut tanpa batas.");
        } else {
          usage.count += 1;
          platformAiUsage.set(key, usage);
          model = resolved.model;
          c.header("x-ai-quota-remaining", String(Math.max(0, platformAiDailyLimit - usage.count)));
        }
      } else {
        model = resolved.model;
      }
      if (!model && !resolved.platform && !notes.length && !rawKey) {
        notes.push("AI platform belum tersedia. Isi kunci AI milikmu sendiri untuk mendapat penjelasan.");
      }
    }

    if (!(await acquireAskSlot())) {
      c.header("retry-after", "20");
      return apiError(c, 503, "BUSY", "Pasla sedang ramai. Coba lagi sebentar lagi.");
    }
    try {
      const data = await ask({ question: parsed.data.question, model, signal: c.req.raw.signal });
      return c.json({ data, meta: { traceId: c.get("traceId"), notes } });
    } finally {
      releaseAskSlot();
    }
  });

  app.post("/v1/uploads", async (c) => {
    if (!uploadStore) return apiError(c, 503, "STORAGE_NOT_CONFIGURED", "Penyimpanan unggahan belum dikonfigurasi.");
    const ownerId = c.get("userId");
    if (!ownerId) return apiError(c, 401, "AUTHENTICATION_REQUIRED", "Akun diperlukan untuk mengunggah dokumen.");
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) return apiError(c, 400, "IDEMPOTENCY_KEY_REQUIRED", "Header Idempotency-Key wajib diisi.");
    const parsed = UploadSchema.safeParse(await readJson(c));
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Metadata unggahan tidak sah.", parsed.error.flatten());
    const data = await uploadStore.createUpload({ ...parsed.data, ownerId, idempotencyKey });
    return c.json({ data, meta: { traceId: c.get("traceId") } }, 201);
  });

  app.put("/v1/uploads/:id/content", async (c) => {
    if (!uploadStore) return apiError(c, 503, "STORAGE_NOT_CONFIGURED", "Penyimpanan unggahan belum dikonfigurasi.");
    const ownerId = c.get("userId");
    if (!ownerId) return apiError(c, 401, "AUTHENTICATION_REQUIRED", "Akun diperlukan untuk mengunggah dokumen.");
    const uploadId = JobIdSchema.safeParse(c.req.param("id"));
    if (!uploadId.success) return apiError(c, 422, "VALIDATION_ERROR", "Upload ID tidak sah.");
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim();
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ] as const;
    if (!contentType || !allowed.includes(contentType as (typeof allowed)[number])) {
      return apiError(c, 422, "CONTENT_TYPE_INVALID", "Content-Type harus PDF atau DOCX.");
    }
    const size = Number(c.req.header("content-length") || 0);
    if (!Number.isInteger(size) || size < 1 || size > 25 * 1024 * 1024) {
      return apiError(c, 413, "UPLOAD_SIZE_INVALID", "Content-Length wajib dan maksimal 25 MB.");
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length !== size) return apiError(c, 400, "CONTENT_LENGTH_MISMATCH", "Ukuran body berbeda dari Content-Length.");
    try {
      const data = await uploadStore.putUpload({
        id: uploadId.data,
        ownerId,
        contentType: contentType as (typeof allowed)[number],
        bytes,
      });
      return c.json({ data, meta: { traceId: c.get("traceId") } }, 202);
    } finally {
      bytes.fill(0);
    }
  });

  app.get("/v1/jobs/:id", async (c) => {
    if (!jobStore) return apiError(c, 503, "JOB_STORE_NOT_CONFIGURED", "Penyimpanan job belum dikonfigurasi.");
    const ownerId = c.get("userId");
    if (!ownerId) return apiError(c, 401, "AUTHENTICATION_REQUIRED", "Akun diperlukan untuk melihat job.");
    const jobId = JobIdSchema.safeParse(c.req.param("id"));
    if (!jobId.success) return apiError(c, 422, "VALIDATION_ERROR", "Job ID tidak sah.");
    const data = await jobStore.getJob(jobId.data, ownerId);
    if (!data) return apiError(c, 404, "JOB_NOT_FOUND", "Job tidak ditemukan.");
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.get("/v1/sources/status", async (c) => {
    const data = await service.getSourceStatus({ importantOnly: c.req.query("importantOnly") === "true" });
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.notFound((c) => apiError(c, 404, "NOT_FOUND", "Endpoint tidak ditemukan."));
  app.onError((error, c) => {
    if (error.message === "PAYLOAD_TOO_LARGE") return apiError(c, 413, "PAYLOAD_TOO_LARGE", "Payload terlalu besar.");
    if (error.message === "INVALID_JSON") return apiError(c, 400, "INVALID_JSON", "Body harus berupa JSON yang sah.");
    if (error.message.startsWith("IDEMPOTENCY_KEY_REUSED")) {
      return apiError(c, 409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key telah dipakai untuk payload berbeda.");
    }
    if (error.message === "UPLOAD_NOT_FOUND") return apiError(c, 404, "UPLOAD_NOT_FOUND", "Unggahan tidak ditemukan.");
    if (error.message === "UPLOAD_SIZE_INVALID") return apiError(c, 413, "UPLOAD_SIZE_INVALID", "Ukuran unggahan tidak sah.");
    if (error.message.startsWith("FILE_SIGNATURE_MISMATCH") || error.message === "CONTENT_TYPE_MISMATCH") {
      return apiError(c, 422, "UPLOAD_CONTENT_INVALID", "Isi berkas tidak sesuai dengan metadata unggahan.");
    }
    return apiError(c, 500, "INTERNAL_ERROR", "Permintaan gagal diproses. Gunakan trace ID untuk pelacakan.");
  });

  return app;
}
