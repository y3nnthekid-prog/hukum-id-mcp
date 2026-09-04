import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";

import type { LegalResearchService, SearchSource } from "../core/service.js";

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
};

const SearchSourceSchema = z.enum([
  "regulation",
  "ma-product",
  "fatwa",
  "ma-decision",
  "mk-decision",
  "literature",
]);

const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(300),
  sources: z.string().optional(),
  number: z.string().trim().max(30).optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
});

const VerifyCitationSchema = z.object({ text: z.string().trim().min(1).max(100_000) });
const ResearchSchema = z.object({ question: z.string().trim().min(4).max(5_000) });
const TimelineSchema = z.object({
  article: z.string().trim().max(80).optional(),
  asOf: z.string().trim().max(40).optional(),
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

function clientId(c: Context<ApiEnv>): string {
  return c.req.header("x-user-id")?.slice(0, 100) || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
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

export function createApiApp({ service, uploadStore, jobStore, allowedOrigins = [], authenticate }: ApiDependencies) {
  const app = new Hono<ApiEnv>();
  const counters = new Map<string, { count: number; resetAt: number }>();

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

    const key = clientId(c);
    const now = Date.now();
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
    c.header("access-control-allow-headers", "authorization,content-type,idempotency-key,x-gemini-api-key");
    return c.body(null, 204);
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "hukum-id-api", version: "0.6.0" }));

  app.get("/v1/search", async (c) => {
    const parsed = SearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Parameter pencarian tidak sah.", parsed.error.flatten());
    const sources = parsed.data.sources
      ? parsed.data.sources.split(",").map((source) => SearchSourceSchema.parse(source.trim()))
      : undefined;
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
    const source = c.req.query("source") === "ma-decision" ? "ma-decision" : "regulation";
    const data = await service.getLegalDocument({ source, ref: c.req.param("id") });
    return c.json({ data, meta: { traceId: c.get("traceId") } });
  });

  app.get("/v1/documents/:id/timeline", async (c) => {
    const parsed = TimelineSchema.safeParse(c.req.query());
    if (!parsed.success) return apiError(c, 422, "VALIDATION_ERROR", "Parameter timeline tidak sah.", parsed.error.flatten());
    const data = await service.traceRegulation({
      regulation: c.req.param("id"),
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
    const data = await service.analyzeLegalProblem(parsed.data);
    return c.json({ data, meta: { traceId: c.get("traceId") } });
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
    const data = await uploadStore.putUpload({
      id: c.req.param("id"),
      ownerId,
      contentType: contentType as (typeof allowed)[number],
      bytes,
    });
    return c.json({ data, meta: { traceId: c.get("traceId") } }, 202);
  });

  app.get("/v1/jobs/:id", async (c) => {
    if (!jobStore) return apiError(c, 503, "JOB_STORE_NOT_CONFIGURED", "Penyimpanan job belum dikonfigurasi.");
    const ownerId = c.get("userId");
    if (!ownerId) return apiError(c, 401, "AUTHENTICATION_REQUIRED", "Akun diperlukan untuk melihat job.");
    const data = await jobStore.getJob(c.req.param("id"), ownerId);
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
    return apiError(c, 500, "INTERNAL_ERROR", "Permintaan gagal diproses. Gunakan trace ID untuk pelacakan.");
  });

  return app;
}
