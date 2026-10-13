import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { z } from "zod";

import { createClaudeJsonModel } from "../src/ai/claude.js";
import { AiProviderError, type JsonModel } from "../src/ai/json-model.js";
import { createOpenAiCompatibleJsonModel } from "../src/ai/openai-compatible.js";
import { heuristicPlan, normalizeArticle, normalizeRegulation, planWithModel } from "../src/ai/planner.js";
import { createApiApp } from "../src/api/app.js";
import { createAsk } from "../src/core/ask.js";

const PASAL_46 =
  "Pasal 46 (1) Dalam hal terjadi kegagalan Pelindungan Data Pribadi, Pengendali Data Pribadi wajib " +
  "menyampaikan pemberitahuan secara tertulis paling lambat 3 x 24 (tiga kali dua puluh empat) jam kepada " +
  "Subjek Data Pribadi dan lembaga.";

function inspectFound(overrides: Record<string, unknown> = {}) {
  return async () => ({
    sumber: "JDIH BPK RI",
    peraturan: {
      id: "229798",
      judul: "Undang-undang (UU) Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi",
      status: "Berlaku",
      tanggal_berlaku: "17 Oktober 2022",
      url: "https://peraturan.bpk.go.id/Details/229798",
      url_pdf: "https://peraturan.bpk.go.id/Download/224884/UU%20Nomor%2027%20Tahun%202022.pdf",
    },
    relasi_status: {},
    pasal: { ditemukan: true, kutipan: [{ halaman: 19, teks: PASAL_46 }] },
    peringatan: [],
    ...overrides,
  });
}

const noSharia = async () => ({ fatwa_dsn: { hasil: [] } });
const emptySearch = async ({ query }: { query: string }) => ({
  traceId: "00000000-0000-4000-8000-000000000001",
  query,
  documents: [],
  sourceStatus: {},
  warnings: [],
  nextCursor: null,
});

function fakeModel(handler: (input: { system: string; user: string }) => unknown): JsonModel {
  return {
    provider: "claude",
    model: "claude-opus-5-5",
    async generate({ system, user, schema }) {
      return schema.parse(handler({ system, user }));
    },
  };
}

// --- perencana ---------------------------------------------------------------

test("rujukan yang ditulis pengguna dikenali tanpa AI, berikut topik syariahnya", () => {
  const plan = heuristicPlan("Apa isi UU 27/2022 Pasal 46 kalau data pembiayaan murabahah bocor?");
  assert.deepEqual(plan.references, [{ regulation: "UU 27/2022", article: "Pasal 46" }]);
  assert.equal(plan.shariaTopic, "murabahah");
  assert.equal(plan.mode, "heuristic");
});

test("bentuk rujukan yang mustahil ditolak sebelum menyentuh sumber", () => {
  assert.equal(normalizeRegulation("UU 999/2099"), null, "tahun di masa depan");
  assert.equal(normalizeRegulation("Undang-undang tentang apa saja"), null);
  assert.equal(normalizeRegulation("Permenkominfo 5/2020"), "Permenkominfo 5/2020");
  assert.equal(normalizeArticle("pasal 46"), "Pasal 46");
  assert.equal(normalizeArticle("Pasal empat puluh enam"), null);
});

test("usulan AI yang bentuknya tidak sah dibuang, rujukan pengguna didahulukan, maksimal tiga", async () => {
  const model = fakeModel(() => ({
    references: [
      { regulation: "UU 13/2003", article: "Pasal 93" },
      { regulation: "Undang-Undang Cipta Kerja", article: "Pasal 81" },
      { regulation: "UU 6/2023", article: "Pasal 81" },
      { regulation: "PP 35/2021", article: "Pasal 59" },
      { regulation: "UU 27/2022", article: "Pasal 46" },
    ],
    searchQuery: "upah tidak dibayar",
    shariaTopic: "",
  }));
  const plan = await planWithModel("Bagaimana UU 27/2022 Pasal 46 dan gaji yang tertahan?", model);
  assert.equal(plan.references.length, 3);
  assert.deepEqual(plan.references[0], { regulation: "UU 27/2022", article: "Pasal 46" });
  assert.ok(!plan.references.some((ref) => ref.regulation.includes("Cipta Kerja")));
  assert.equal(plan.shariaTopic, null);
});

// --- orkestrasi -------------------------------------------------------------

test("tanpa AI, kutipan resmi tampil apa adanya dengan status dan sumbernya", async () => {
  const ask = createAsk({
    adapters: { inspectArticle: inspectFound(), researchSharia: noSharia },
    service: { searchLegalSources: emptySearch as any },
  });
  const data = await ask({ question: "Apa bunyi UU 27/2022 Pasal 46?" });
  assert.equal(data.result.status, "complete");
  assert.equal(data.result.evidence.length, 1);
  assert.equal(data.sources[0]?.status, "Berlaku");
  assert.equal(data.sources[0]?.evidenceIds[0], data.result.evidence[0]?.id);
  assert.equal(data.result.evidence[0]?.locator.page, 19);
  assert.ok(data.result.warnings.some((w) => /AI tidak aktif/.test(w)));
  assert.equal(data.ai, null);
});

test("klaim AI yang tidak didukung teks dibuang; yang setia pada kutipan dipertahankan", async () => {
  const ask = createAsk({
    adapters: { inspectArticle: inspectFound(), researchSharia: noSharia },
    service: { searchLegalSources: emptySearch as any },
  });
  const model = fakeModel(({ user }) => {
    const payload = JSON.parse(user) as { question?: string; evidence?: Array<{ id: string }> };
    if (!payload.evidence) {
      return { references: [], searchQuery: "data pribadi", shariaTopic: "" };
    }
    const id = payload.evidence[0]!.id;
    return {
      summary: "Pengendali wajib memberi tahu dalam 3 x 24 jam.",
      claims: [
        {
          text: "Pengendali Data Pribadi wajib menyampaikan pemberitahuan secara tertulis paling lambat 3 x 24 jam kepada Subjek Data Pribadi",
          evidenceIds: [id],
        },
        { text: "Pengendali Data Pribadi tidak wajib memberi tahu dalam 7 x 24 jam", evidenceIds: [id] },
        { text: "Denda pelanggaran mencapai 5 miliar rupiah", evidenceIds: ["ev_000000000000000000000000"] },
      ],
      conflicts: [],
    };
  });
  const data = await ask({ question: "Kalau data bocor, UU 27/2022 Pasal 46 mewajibkan apa?", model });
  assert.equal(data.ai?.used, true);
  assert.equal(data.result.claims.length, 1, "hanya klaim yang setia pada kutipan yang lolos");
  assert.match(data.result.claims[0]!.text, /3 x 24 jam/);
  assert.ok(data.result.warnings.some((w) => /2 klaim dibuang/.test(w)));
});

test("kegagalan AI tidak menghapus kutipan resmi yang sudah didapat", async () => {
  const ask = createAsk({
    adapters: { inspectArticle: inspectFound(), researchSharia: noSharia },
    service: { searchLegalSources: emptySearch as any },
  });
  let calls = 0;
  const model: JsonModel = {
    provider: "gemini",
    model: "uji",
    async generate({ schema }) {
      calls += 1;
      if (calls === 1) return schema.parse({ references: [], searchQuery: "data pribadi", shariaTopic: "" });
      throw new AiProviderError("Gemini sedang membatasi kuota kunci ini. Coba lagi nanti.");
    },
  };
  const data = await ask({ question: "Apa isi UU 27/2022 Pasal 46?", model });
  assert.equal(data.result.evidence.length, 1);
  assert.equal(data.ai?.used, false);
  assert.ok(data.result.warnings.some((w) => /membatasi kuota/.test(w) && /Kutipan resmi tetap/.test(w)));
});

test("rujukan yang tidak ditemukan dilaporkan apa adanya, tanpa kutipan pengganti", async () => {
  const ask = createAsk({
    adapters: {
      inspectArticle: async () => ({ ditemukan: false, status: "not_found", catatan: "Peraturan dengan identitas persis tidak ditemukan." }),
      researchSharia: noSharia,
    },
    service: {
      searchLegalSources: (async ({ query }: { query: string }) => ({
        ...(await emptySearch({ query })),
        documents: [
          {
            id: "bpk:1",
            jurisdiction: "ID",
            authority: "JDIH BPK RI",
            documentType: "UU",
            number: "13",
            year: "2003",
            title: "Ketenagakerjaan",
            status: "Berlaku",
            effectiveFrom: null,
            effectiveTo: null,
            canonicalUrl: "https://peraturan.bpk.go.id/Details/43013",
          },
        ],
      })) as any,
    },
  });
  const data = await ask({ question: "Bagaimana UU 999/2020 Pasal 1 mengatur upah?" });
  assert.equal(data.result.evidence.length, 0);
  assert.equal(data.result.status, "insufficient_evidence");
  assert.ok(data.attempted.some((line) => /tidak ditemukan persis/.test(line)));
  assert.equal(data.candidates[0]?.title, "Ketenagakerjaan");
});

test("peraturan yang sudah dicabut diberi peringatan, bukan disajikan sebagai hukum berlaku", async () => {
  const ask = createAsk({
    adapters: {
      inspectArticle: inspectFound({
        peraturan: {
          id: "1",
          judul: "Undang-undang (UU) Nomor 8 Tahun 1981 tentang Hukum Acara Pidana",
          status: "Tidak Berlaku",
          url: "https://peraturan.bpk.go.id/Details/1",
          url_pdf: "https://peraturan.bpk.go.id/Download/1/uu.pdf",
        },
        relasi_status: { "Dicabut dengan": [{ peraturan: "UU No. 20 Tahun 2025" }] },
      }),
      researchSharia: noSharia,
    },
    service: { searchLegalSources: emptySearch as any },
  });
  const data = await ask({ question: "Apa isi UU 8/1981 Pasal 46?" });
  assert.deepEqual(data.sources[0]?.revokedBy, ["UU No. 20 Tahun 2025"]);
  assert.ok(data.result.warnings.some((w) => /Tidak Berlaku/.test(w) && /penggantinya/.test(w)));
});

// --- rute API ----------------------------------------------------------------

const SECRET = "sk-uji-RAHASIA-1234567890";

function askApp(overrides: Partial<Parameters<typeof createApiApp>[0]> = {}) {
  const calls: Array<{ model: JsonModel | null }> = [];
  const app = createApiApp({
    service: {} as any,
    ask: (async (input: { model?: JsonModel | null }) => {
      calls.push({ model: input.model ?? null });
      return { ok: true, model: input.model?.provider ?? null };
    }) as any,
    resolveAiModel: (selection) =>
      selection.apiKey
        ? selection.provider
          ? { model: fakeModel(() => ({})), platform: false }
          : { error: "PROVIDER_REQUIRED" }
        : { model: fakeModel(() => ({})), platform: true },
    ...overrides,
  });
  return { app, calls };
}

async function post(app: ReturnType<typeof createApiApp>, headers: Record<string, string> = {}, body = { question: "Apa isi UU 27/2022 Pasal 46?" }) {
  return app.request("/v1/ask", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("kunci BYOK yang formatnya rusak ditolak tanpa dipantulkan", async () => {
  const { app } = askApp();
  const response = await post(app, { "x-pasla-ai-provider": "claude", "x-pasla-ai-key": "bad key with spaces" });
  const text = await response.text();
  assert.equal(response.status, 422);
  assert.ok(!text.includes("bad key"));
});

test("kunci tanpa penyedia meminta penyedia dipilih", async () => {
  const { app } = askApp();
  const response = await post(app, { "x-pasla-ai-key": SECRET });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "PROVIDER_REQUIRED");
  assert.ok(!JSON.stringify(body).includes(SECRET));
});

test("kuota AI platform habis berarti lanjut tanpa AI dengan catatan, bukan galat", async () => {
  const { app, calls } = askApp({ platformAiDailyLimit: 1 });
  const first = await post(app);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-ai-quota-remaining"), "0");
  const second = await post(app);
  const body = await second.json();
  assert.equal(second.status, 200);
  assert.equal(calls[1]?.model, null);
  assert.ok(body.meta.notes.some((note: string) => /Kuota penjelasan AI gratis/.test(note)));
});

test("BYOK tidak dikenai kuota platform", async () => {
  const { app, calls } = askApp({ platformAiDailyLimit: 0 });
  const response = await post(app, { "x-pasla-ai-provider": "claude", "x-pasla-ai-key": SECRET });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.notEqual(calls[0]?.model, null);
  assert.ok(!text.includes(SECRET));
});

test("antrean penuh menjawab sedang ramai, bukan menumpuk beban ke sumber", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const app = createApiApp({
    service: {} as any,
    askConcurrency: { active: 1, queued: 0 },
    ask: (async () => {
      await gate;
      return { ok: true };
    }) as any,
  });
  const first = post(app, {}, { question: "Pertanyaan pertama yang panjang", useAi: false } as any);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await post(app, {}, { question: "Pertanyaan kedua yang panjang", useAi: false } as any);
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, "BUSY");
  release();
  assert.equal((await first).status, 200);
});

// --- penyedia AI ----------------------------------------------------------

test("penyedia kompatibel OpenAI mengurai JSON dan tidak memantulkan isi galat penyedia", async () => {
  const ok = createOpenAiCompatibleJsonModel({
    provider: "groq",
    apiKey: SECRET,
    model: "model-uji",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"jawab":"ya"}' } }] }), { status: 200 });
    },
  });
  assert.deepEqual(await ok.generate({ system: "s", user: "u", schema: z.object({ jawab: z.string() }), effort: "low" }), {
    jawab: "ya",
  });

  const rejected = createOpenAiCompatibleJsonModel({
    provider: "openai",
    apiKey: SECRET,
    model: "model-uji",
    fetchImpl: async () => new Response(`{"error":"invalid key ${SECRET}"}`, { status: 401 }),
  });
  await assert.rejects(
    rejected.generate({ system: "s", user: "u", schema: z.object({}), effort: "low" }),
    (error: Error) => error instanceof AiProviderError && /ditolak/.test(error.message) && !error.message.includes(SECRET)
  );
});

test("penyedia Claude memakai keluaran terstruktur dan mengubah 401 menjadi pesan aman", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push(body);
      if (request.headers["x-api-key"] === "kunci-salah-12345") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "msg_uji",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: '{"jawab":"ya"}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const model = createClaudeJsonModel({ apiKey: "kunci-benar-12345", baseURL });
    assert.equal(model.model, "claude-opus-5-5");
    const out = await model.generate({ system: "s", user: "u", schema: z.object({ jawab: z.string() }), effort: "low" });
    assert.deepEqual(out, { jawab: "ya" });
    const sent = seen[0]!;
    assert.equal((sent.output_config as { effort?: string }).effort, "low");
    assert.equal(((sent.output_config as { format?: { type?: string } }).format)?.type, "json_schema");
    assert.equal(sent.fallbacks, "default");

    const wrong = createClaudeJsonModel({ apiKey: "kunci-salah-12345", baseURL });
    await assert.rejects(
      wrong.generate({ system: "s", user: "u", schema: z.object({}), effort: "low" }),
      (error: Error) => error instanceof AiProviderError && /ditolak/.test(error.message) && !error.message.includes("kunci-salah")
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// --- regresi sumber -----------------------------------------------------------

test("singkatan kementerian diterjemahkan ke nama yang dicari JDIH BPK", async () => {
  const { kataKunciUntukJenis } = await import("../src/alur.js");
  assert.equal(kataKunciUntukJenis("Permenkominfo"), "Komunikasi dan Informatika");
  assert.equal(kataKunciUntukJenis("permenaker"), "Ketenagakerjaan");
  assert.equal(kataKunciUntukJenis("UU"), null, "jenis yang sudah dicari dengan benar tidak diubah");
});

test("halaman tantangan Cloudflare dikenali sebagai pembatasan, bukan galat sesaat", async () => {
  const { tantanganCloudflare } = await import("../src/http.js");
  const challenge = Buffer.from('<!DOCTYPE html><html><head><title>Just a moment...</title><script src="https://challenges.cloudflare.com/x"></script>');
  assert.equal(tantanganCloudflare({ status: 403, buffer: challenge }), true);
  assert.equal(tantanganCloudflare({ status: 403, buffer: Buffer.from("<html>Forbidden</html>") }), false);
  assert.equal(tantanganCloudflare({ status: 200, buffer: challenge }), false, "hanya status penolakan");
});

test("fatwa yang mengatur akadnya didahulukan atas fatwa terbaru yang sekadar menyebutnya", async () => {
  const { pilihFatwaUtama } = await import("../src/alur.js");
  const hasil = [
    { nomor: "153/DSN-MUI/VI/2022", judul: "Pelunasan Utang Pembiayaan Murabahah Sebelum Jatuh Tempo" },
    { nomor: "111/DSN-MUI/IX/2017", judul: "Akad Jual Beli Murabahah" },
    { nomor: "04/DSN-MUI/IV/2000", judul: "Murabahah" },
  ];
  assert.equal(pilihFatwaUtama(hasil, "murabahah").nomor, "111/DSN-MUI/IX/2017", "skor sama, urutan asli dipertahankan");
  assert.equal(pilihFatwaUtama(hasil, "").nomor, "153/DSN-MUI/VI/2022");
  assert.equal(pilihFatwaUtama([], "murabahah"), undefined);
});

test("kata generik tidak dijadikan topik syariah, nama akad yang spesifik dipakai", () => {
  assert.equal(heuristicPlan("Bagaimana aturan akad murabahah?").shariaTopic, "murabahah");
  assert.equal(heuristicPlan("Apa itu akad dalam ekonomi syariah?").shariaTopic, null);
});
