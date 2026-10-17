import type { Context, Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";

import { AiModelNameSchema, AiProviderIdSchema, type AiProviderId, type JsonModel } from "../ai/json-model.js";
import { sintesisBagian } from "../core/sintesis.js";
import type { Signer } from "../core/sign.js";
import type { PotonganBertanda, RujukanBuka, SumberService } from "../core/sumber.js";
import { isMkBpkUrl, MK_NUMBER } from "../core/rujukan.js";
import { JENIS_TELUSUR, RUMPUN, type RumpunId } from "../rumpun/index.js";
import type { TelusurService } from "../core/telusur.js";
import { RencanaSchema, rencanaLaporan, saringLaporan, type KandidatSaring } from "../core/laporan.js";
import { createTicketGuard } from "../core/step-ticket.js";

/**
 * API v2: riset bertahap untuk ruang riset enam rumpun.
 *
 * - POST /v2/sumber/buka       rujukan -> potongan bertanda tangan (tanpa AI)
 * - POST /v2/laporan/sintesis  satu bagian laporan dari potongan bertanda tangan (BYOK, NDJSON)
 * - GET  /v2/kunci-publik      kunci publik penandatangan untuk diperiksa aplikasi web
 *
 * Mesin tetap tanpa status: tidak ada pertanyaan, laporan, atau kunci AI yang disimpan.
 */

type Env = { Variables: { traceId: string; userId: string | null } };

export type V2Dependencies = {
  matchCorpusHash?: ((hash: string) => { judul: string; sourceUrl: string } | null) | undefined;
  stepTickets?: { secret: string; audience: string } | undefined;
  requireStepTicket?: boolean | undefined;
  telusur?: TelusurService | undefined;
  sumber?: SumberService | undefined;
  signer?: Signer | undefined;
  /** Kunci publik lain yang masih diterima selama masa rotasi. */
  extraPublicKeysPem?: string[] | undefined;
  makeByokModel?: ((selection: { provider: AiProviderId; model?: string | undefined; apiKey: string }) => JsonModel) | undefined;
  /** Batas konkurensi: pembukaan sumber mengurai PDF (berat memori), sintesis menunggu penyedia AI (ringan). */
  pools?: { buka: number; sintesis: number; antrean: number } | undefined;
  deadlineMs?: number | undefined;
};

const ByokKeySchema = z.string().regex(/^[\x21-\x7e]{8,512}$/);
const ArticleSchema = z.string().trim().regex(/^Pasal\s+(?:\d{1,4}[A-Z]?|[IVX]{1,6})$/i);

const RujukanSchema = z.discriminatedUnion("jenis", [
  z.object({ jenis: z.literal("khi"), pasal: ArticleSchema }),
  z.object({ jenis: z.literal("qanun"), rujukan: z.string().regex(/^Qanun(?: Aceh)? \d{1,3}\/\d{4}$/i), pasal: ArticleSchema.optional() }),
  z.object({ jenis: z.literal("putusan"), id: z.string().regex(/^[a-zA-Z0-9:._-]{1,120}$/) }),
  z.object({ jenis: z.literal("putusan-mk-bpk"), nomor: z.string().regex(MK_NUMBER), url: z.string().max(1000).refine(isMkBpkUrl), halaman: z.number().int().min(1).max(600).optional() }),
  z.object({ jenis: z.literal("peraturan"), rujukan: z.string().trim().min(3).max(60), pasal: ArticleSchema.optional() }),
  z.object({ jenis: z.literal("fatwa"), nomor: z.string().trim().regex(/^\d{1,3}\/DSN-MUI\/[IVX]+\/\d{4}$/) }),
  z.object({ jenis: z.literal("khes"), pasal: ArticleSchema }),
  z.object({ jenis: z.literal("ayat"), surah: z.number().int().min(1).max(114), ayat: z.number().int().min(1).max(286) }),
  z.object({ jenis: z.literal("hadis"), id: z.string().trim().regex(/^\d{1,8}$/) }),
  z.object({ jenis: z.literal("turats"), query: z.string().trim().min(2).max(120), limit: z.number().int().min(1).max(10).optional() }),
]);

const BukaSchema = z.object({ rujukan: z.array(RujukanSchema).min(1).max(8) });
const RumpunSchema = z.enum(Object.keys(RUMPUN) as [RumpunId, ...RumpunId[]]);
const TelusurSchema = z.object({ rumpun: RumpunSchema, query: z.string().trim().min(2).max(300), sumber: z.array(z.enum(JENIS_TELUSUR)).min(1).max(10).optional(), limit: z.number().int().min(1).max(50).optional() });
const RencanaInputSchema = z.object({ rumpun: RumpunSchema, pertanyaan: z.string().trim().min(4).max(2000) });
const SaringInputSchema = z.object({ rencana: RencanaSchema, kandidat: z.array(z.object({ id: z.string().min(1).max(100), judul: z.string().max(500), statusBuka: z.enum(["dibuka", "tidak_ditemukan", "tidak_dapat_diperiksa"]), potongan: z.array(z.record(z.string(), z.unknown())).max(24) })).max(24) });

const SintesisSchema = z.object({
  pertanyaan: z.string().trim().min(4).max(2_000),
  bagian: z.object({ judul: z.string().trim().min(1).max(120), fokus: z.string().trim().min(1).max(600) }),
  // Bentuk potongan diperiksa longgar di sini; keabsahannya ditentukan tanda tangan, bukan skema.
  potongan: z.array(z.record(z.string(), z.unknown())).min(1).max(24),
});

class Pool {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(
    private readonly size: number,
    private readonly queue: number
  ) {}
  async acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    if (this.active < this.size) {
      this.active += 1;
      return true;
    }
    if (this.waiting.length >= this.queue) return false;
    return new Promise<boolean>((resolve) => {
      const ticket = () => {
        signal.removeEventListener("abort", abort);
        resolve(true);
      };
      const abort = () => {
        this.waiting = this.waiting.filter((item) => item !== ticket);
        resolve(false);
      };
      this.waiting.push(ticket);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  release() {
    // Serahkan slot langsung ke antrean, agar pemanggil baru tidak mendahuluinya.
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

/** Respons boleh berakhir saat tenggat, tetapi slot tetap ditahan sampai pekerjaan benar-benar selesai. */
function beforeAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (cause) => { signal.removeEventListener("abort", abort); reject(cause); }
    );
    if (signal.aborted) abort();
  });
}

async function readBoundedJson(c: Context<Env>, maxBytes: number) {
  const declared = Number(c.req.header("content-length") || 0);
  if (declared > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  // Batas juga diterapkan pada isi sebenarnya: body chunked tidak membawa content-length.
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new Error("INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error("PAYLOAD_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function error(c: Context<Env>, status: 401 | 413 | 422 | 429 | 503, code: string, message: string, details?: unknown) {
  return c.json({ error: { code, message, ...(details === undefined ? {} : { details }), traceId: c.get("traceId") } }, status);
}

export function registerV2(app: Hono<Env>, deps: V2Dependencies) {
  const guard = deps.stepTickets ? createTicketGuard(deps.stepTickets.secret, deps.stepTickets.audience) : null;
  const pools = deps.pools ?? { buka: 2, sintesis: 8, antrean: 12 };
  const bukaPool = new Pool(pools.buka, pools.antrean);
  const sintesisPool = new Pool(pools.sintesis, pools.antrean);
  const deadlineMs = deps.deadlineMs ?? 80_000;
  const publicKeys = () => [deps.signer?.publicKeyPem, ...(deps.extraPublicKeysPem ?? [])].filter((item): item is string => Boolean(item));

  app.get("/v2/rumpun", (c) => c.json({ data: RUMPUN, meta: { traceId: c.get("traceId") } }));
  app.post("/v2/sumber/unggahan", async (c) => {
    const parsed = z.object({ fileHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(await readBoundedJson(c, 1000));
    if (!parsed.success) return error(c, 422, "VALIDATION_ERROR", "Kirim hanya sidik SHA-256, bukan isi berkas.");
    const match = deps.matchCorpusHash?.(parsed.data.fileHash);
    return c.json({ data: match ? { status: "hash_korpus_cocok", judul: match.judul, sourceUrl: match.sourceUrl, alasan: "Sidik yang dikirim cocok dengan dokumen korpus. Kutipan resmi harus tetap dibuka dari korpus mesin, bukan disalin dari ekstraksi peramban." } : { status: "unggahan_tidak_terverifikasi", alasan: "Sidik belum dikenal pada korpus. Teks lokal tetap tidak terverifikasi dan tidak dapat dipakai sebagai bukti resmi untuk sintesis." }, meta: { traceId: c.get("traceId") } });
  });
  app.post("/v2/telusur", async (c) => {
    const parsed = TelusurSchema.safeParse(await readBoundedJson(c, 20_000));
    if (!parsed.success) return error(c, 422, "VALIDATION_ERROR", "Permintaan telusur tidak sah.", parsed.error.flatten());
    const telusur = deps.telusur;
    if (!telusur) return error(c, 503, "SEARCH_NOT_CONFIGURED", "Penelusuran belum tersedia.");
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(deadlineMs)]);
    if (!(await bukaPool.acquire(signal))) return error(c, 503, signal.aborted ? "DEADLINE" : "BUSY", "Penelusuran sedang penuh atau dibatalkan.");
    try {
      const data = await beforeAbort(telusur(parsed.data).finally(() => bukaPool.release()), signal);
      return c.json({ data, meta: { traceId: c.get("traceId") } });
    } catch (cause) {
      if (signal.aborted) return error(c, 503, "DEADLINE", "Batas waktu penelusuran habis.");
      throw cause;
    }
  });

  app.get("/v2/kunci-publik", (c) => {
    if (!deps.signer) return error(c, 503, "SIGNING_NOT_CONFIGURED", "Penandatanganan belum dikonfigurasi pada server ini.");
    return c.json({ data: { alg: "Ed25519", kid: deps.signer.kid, kunci: publicKeys() }, meta: { traceId: c.get("traceId") } });
  });

  for (const path of ["/v2/sumber/buka", "/v2/sumber/potongan"]) app.post(path, async (c) => {
    const sumber = deps.sumber;
    if (!sumber || !deps.signer) return error(c, 503, "SIGNING_NOT_CONFIGURED", "Pembukaan sumber v2 belum dikonfigurasi pada server ini.");
    const parsed = BukaSchema.safeParse(await readBoundedJson(c, 20_000));
    if (!parsed.success) return error(c, 422, "VALIDATION_ERROR", "Rujukan tidak sah.", parsed.error.flatten());
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(deadlineMs)]);
    if (!(await bukaPool.acquire(signal))) {
      if (signal.aborted) return error(c, 503, "DEADLINE", "Permintaan dibatalkan atau batas waktunya habis.");
      c.header("retry-after", "20");
      return error(c, 503, "BUSY", "Pasla sedang ramai. Coba lagi sebentar lagi.");
    }
    const opening = (async () => {
      const results = [];
      for (const ref of parsed.data.rujukan) {
        if (signal.aborted) {
          results.push({ rujukan: ref, status: "tidak_dapat_diperiksa", alasan: "Batas waktu permintaan habis.", potongan: [], peringatan: [] });
          continue;
        }
        results.push(await sumber.buka(ref as RujukanBuka));
      }
      return results;
    })().finally(() => bukaPool.release());
    try {
      const results = await beforeAbort(opening, signal);
      return c.json({ data: results, meta: { traceId: c.get("traceId"), kid: deps.signer?.kid ?? null } });
    } catch (cause) {
      if (signal.aborted) return error(c, 503, "DEADLINE", "Batas waktu pembukaan sumber habis atau permintaan dibatalkan.");
      throw cause;
    }
  });

  function paidStep<T>(path: string, schema: z.ZodType<T>, run: (input: T, model: JsonModel, signal: AbortSignal, signer: Signer) => Promise<unknown>) {
    app.post(path, async (c) => {
    if (!deps.signer || !deps.makeByokModel) {
      return error(c, 503, "SIGNING_NOT_CONFIGURED", "Sintesis v2 belum dikonfigurasi pada server ini.");
    }
    const parsed = schema.safeParse(await readBoundedJson(c, 2_000_000));
    if (!parsed.success) return error(c, 422, "VALIDATION_ERROR", "Permintaan sintesis tidak sah.", parsed.error.flatten());

    const rawKey = c.req.header("x-pasla-ai-key")?.trim();
    const rawProvider = c.req.header("x-pasla-ai-provider")?.trim();
    const rawModel = c.req.header("x-pasla-ai-model")?.trim() || undefined;
    if (!rawKey || !rawProvider) return error(c, 422, "AI_KEY_REQUIRED", "Sintesis laporan memakai kunci AI milikmu sendiri.");
    const provider = AiProviderIdSchema.safeParse(rawProvider);
    if (!provider.success) return error(c, 422, "AI_PROVIDER_INVALID", "Penyedia AI tidak dikenal.");
    if (!ByokKeySchema.safeParse(rawKey).success) return error(c, 422, "BYOK_INVALID", "Format kunci API tidak sah.");
    if (rawModel !== undefined && !AiModelNameSchema.safeParse(rawModel).success) {
      return error(c, 422, "AI_MODEL_INVALID", "Nama model tidak sah.");
    }
    if (deps.requireStepTicket && !guard) return error(c, 503, "TICKET_NOT_CONFIGURED", "Tiket akun untuk langkah AI belum dikonfigurasi.");
    if (guard) {
      try { guard(c.req.header("x-pasla-step-ticket") || "", path.split("/").at(-1)!, parsed.data); }
      catch (cause) {
        const rate = cause instanceof Error && cause.message === "ACCOUNT_RATE_LIMIT";
        return error(c, rate ? 429 : 401, rate ? "ACCOUNT_RATE_LIMIT" : "TICKET_INVALID", rate ? "Batas enam langkah per menit untuk akun tercapai." : "Tiket langkah tidak sah, sudah dipakai, atau kedaluwarsa.");
      }
    }
    let model: JsonModel;
    try {
      model = deps.makeByokModel({ provider: provider.data, model: rawModel, apiKey: rawKey });
    } catch (cause) {
      const message = cause instanceof Error && cause.message === "MODEL_REQUIRED" ? "Penyedia ini membutuhkan nama model." : "Penyedia AI tidak didukung.";
      return error(c, 422, "AI_MODEL_INVALID", message);
    }

    const cancelled = new AbortController();
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(deadlineMs), cancelled.signal]);
    if (!(await sintesisPool.acquire(signal))) {
      if (signal.aborted) return error(c, 503, "DEADLINE", "Permintaan dibatalkan atau batas waktunya habis.");
      c.header("retry-after", "20");
      return error(c, 503, "BUSY", "Pasla sedang ramai. Coba lagi sebentar lagi.");
    }

    // Header dikirim segera lalu hasil menyusul sebagai NDJSON, sehingga sintesis yang lama tidak
    // diputus proxy Cloudflare (batas 100 detik sampai byte pertama).
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    const signer = deps.signer;
    return stream(c, async (out) => {
      out.onAbort(() => cancelled.abort());
      const write = (value: unknown) => out.write(`${JSON.stringify(value)}\n`);
      const keepAlive = setInterval(() => void write({ jenis: "proses" }), 10_000);
      let workStarted = false;
      try {
        await write({ jenis: "mulai", traceId: c.get("traceId") });
        signal.throwIfAborted();
        workStarted = true;
        const work = run(parsed.data, model, signal, signer).finally(() => sintesisPool.release());
        const hasil = await beforeAbort(work, signal);
        await write({ jenis: "hasil", data: hasil });
      } catch (cause) {
        const aborted = signal.aborted;
        await write({
          jenis: "galat",
          kode: aborted ? "DEADLINE" : "AI_PROVIDER_ERROR",
          pesan: aborted
            ? "Batas waktu habis sebelum penyedia AI menjawab. Kurangi jumlah potongan lalu ulangi bagian ini."
            : cause instanceof Error && cause.name === "AiProviderError"
              ? cause.message
              : "Penyedia AI gagal menjawab. Bagian ini bisa diulang tanpa mengulang langkah lain.",
        });
      } finally {
        clearInterval(keepAlive);
        if (!workStarted) sintesisPool.release();
      }
    });
    });
  }
  paidStep("/v2/laporan/sintesis", SintesisSchema, (input, model, signal, signer) => sintesisBagian({ ...input, potongan: input.potongan as unknown as PotonganBertanda[], model, signer, signal, publicKeysPem: publicKeys() }));
  paidStep("/v2/laporan/rencana", RencanaInputSchema, (input, model, signal, signer) => rencanaLaporan({ ...input, model, signer, signal }));
  paidStep("/v2/laporan/saring", SaringInputSchema, (input, model, signal, signer) => saringLaporan({ ...input, kandidat: input.kandidat as unknown as KandidatSaring[], model, signer, signal, publicKeysPem: publicKeys() }));
}
