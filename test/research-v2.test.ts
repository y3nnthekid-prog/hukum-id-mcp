import assert from "node:assert/strict";
import test from "node:test";
import { RUMPUN } from "../src/rumpun/index.js";
import { createTelusur } from "../src/core/telusur.js";
import { createApiApp } from "../src/api/app.js";
import { RencanaSchema, saringLaporan } from "../src/core/laporan.js";
import { createSigner, generateSigningKey } from "../src/core/sign.js";
import { contentHash } from "../src/core/passages.js";
import { createSumberService, signedPart, type PotonganBertanda } from "../src/core/sumber.js";
import { uraikanHalamanTurats } from "../src/turats.js";

test("turats discovery pins book and internal page separately from printed pagination", async () => {
  const telusur = createTelusur({ turats: async () => ({ hasil: [{ kitab: "Kitab uji", book_id: 12, page_id: 437, halaman: 439, cuplikan: "Kutipan uji" }] }) });
  const result = await telusur({ rumpun: "perbandingan-madzhab", query: "خيار المجلس", sumber: ["turats"] });
  assert.deepEqual(result.kandidat[0]!.rujukan, { jenis: "turats", bookId: 12, pageId: 437 });
});

test("exact turats opening keeps edition and rejects a mismatched book or page", () => {
  const book = { meta: { id: 12, name: "Kitab uji", info: "Edisi uji, penerbit uji", author_id: 7, version: "1" } };
  const page = { meta: JSON.stringify({ page_id: 437, page: 439, vol: "1", book_name: "Kitab uji", author_name: "Penulis uji" }), text: "Kutipan Arab uji yang dibuka dari halaman tertentu." };
  const parsed = uraikanHalamanTurats(book, page, { bookId: 12, pageId: 437 });
  assert.equal(parsed.hasil[0]!.halaman, 439);
  assert.equal(parsed.hasil[0]!.edisi, book.meta.info);
  assert.equal(parsed.hasil[0]!.page_id, 437);
  assert.throws(() => uraikanHalamanTurats(book, page, { bookId: 13, pageId: 437 }));
  assert.throws(() => uraikanHalamanTurats(book, page, { bookId: 12, pageId: 439 }));
  assert.throws(() => uraikanHalamanTurats(book, {...page,meta:JSON.stringify({page_id:null,book_name:'Kitab uji'})}, { bookId:12,pageId:0 }));
});

test("exact turats references reach the exact adapter and preserve signed provenance", async () => {
  const signer = createSigner(generateSigningKey());
  const source = createSumberService({ turats: async () => { throw Error("Must not re-search"); }, turatsPage: async ({ bookId, pageId }: { bookId: number; pageId: number }) => ({ hasil: [{ book_id: bookId, page_id: pageId, kitab: "Kitab uji", penulis: "Penulis uji", halaman: 439, edisi: "Edisi uji", cuplikan: "Teks uji" }] }) } as any, signer);
  const opened = await source.buka({ jenis: "turats", bookId: 12, pageId: 437 });
  assert.equal(opened.status, "dibuka");
  assert.equal(opened.potongan[0]!.locator.pageId, 437);
  assert.equal(opened.potongan[0]!.locator.halamanAwal, 439);
  assert.equal(opened.potongan[0]!.sumber.edisi, "Edisi uji");
  const next=await source.buka({jenis:'turats',bookId:12,pageId:438});
  assert.notEqual(opened.potongan[0]!.id,next.potongan[0]!.id);
  const incompleteEdition=createSumberService({turats:async()=>({}),turatsPage:async()=>({hasil:[{book_id:12,page_id:438,kitab:'Kitab',halaman:'pendahuluan',cuplikan:'teks',versi:'3',terpotong:true}]})} as any,signer);
  const partial=await incompleteEdition.buka({jenis:'turats',bookId:12,pageId:438});
  assert.equal(partial.potongan[0]!.sumber.teksTerpotong,true);
  assert.equal(partial.potongan[0]!.sumber.versiTranskripsi,'3');
  assert.equal(partial.potongan[0]!.locator.halamanAwal,undefined);
  assert.equal(partial.potongan[0]!.locator.halamanCetak,'pendahuluan');
});

test('turats API accepts exact or legacy references, rejecting mixed or incomplete locations', async () => {
  const signer=createSigner(generateSigningKey());
  const received:unknown[]=[];
  const source={publicKeyPem:signer.publicKeyPem,kid:signer.kid,buka:async(ref:any)=>{received.push(ref);return {rujukan:ref,status:'tidak_ditemukan' as const,potongan:[],peringatan:[]};}};
  const app=createApiApp({service:{} as any,signer,sumber:source});
  const post=(ref:unknown)=>app.request('/v2/sumber/potongan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rujukan:[ref]})});
  for(const ref of [{jenis:'turats',bookId:12,pageId:0},{jenis:'turats',query:'خيار المجلس',limit:2}])assert.equal((await post(ref)).status,200);
  for(const ref of [{bookId:12},{pageId:12},{bookId:12,pageId:0,query:'abc'},{bookId:12,pageId:0,limit:2},{bookId:-1,pageId:0},{bookId:12,pageId:1000001}])assert.equal((await post({jenis:'turats',...ref})).status,422);
  assert.equal(received.length,2);
});

test("six research profiles expose coverage limits and source authority", () => {
  assert.equal(Object.keys(RUMPUN).length, 6);
  for (const profile of Object.values(RUMPUN)) {
    assert.equal(profile.cakupan.status, "terbatas");
    assert.ok(profile.bagian.length >= 3);
    assert.ok(profile.sumber.length >= 3);
  }
});

test("search isolates unavailable sources, clips snippets, and never claims metadata is verified text", async () => {
  const telusur = createTelusur({
    peraturan: async () => ({ hasil: [{ judul: "Dokumen uji", jenis: "UU", nomor: "10", tahun: "2020", url: "https://peraturan.bpk.go.id/Details/123/uji", status: "Tidak Berlaku" }] }),
    fatwa: async () => ({ hasil: [{ nomor: "01/DSN-MUI/I/2000", judul: "Fatwa uji", url: "https://dsnmui.or.id/uji", cuplikan: "a".repeat(900) }] }),
    khes: async () => ({ tersedia: false }),
    turats: async () => { throw new Error("Tidak tersedia"); },
  });
  const result = await telusur({ rumpun: "hes", query: "akad uji", sumber: ["peraturan", "fatwa", "khes", "turats"], limit: 20 });
  assert.equal(result.kandidat.length, 2);
  assert.equal(result.sumber.find((x) => x.jenis === "khes")!.status, "belum_tersedia");
  assert.equal(result.sumber.find((x) => x.jenis === "turats")!.status, "tidak_dapat_diperiksa");
  const fatwa = result.kandidat.find((x) => x.jenis === "fatwa")!;
  assert.equal(fatwa.lapisan, "pedoman");
  assert.ok(fatwa.cuplikan.length <= 600);
  assert.ok(result.kandidat.every((x) => x.verificationStatus === "metadata_only"));
  assert.equal(result.kandidat[0]!.status, "Tidak Berlaku");
  assert.equal(result.kueri, "akad uji");
});

test("a single source cannot starve other sources from a limited search result", async () => {
  const telusur = createTelusur({
    peraturan: async () => ({ hasil: Array.from({ length: 15 }, (_, i) => ({ judul: `Uji ${i}`, url: `https://peraturan.bpk.go.id/${i}` })) }),
    fatwa: async () => ({ hasil: [{ judul: "Fatwa", url: "https://dsnmui.or.id/uji" }] }),
  });
  const result = await telusur({ rumpun: "hes", query: "uji", sumber: ["peraturan", "fatwa"], limit: 2 });
  assert.deepEqual(result.kandidat.map((x) => x.jenis), ["peraturan", "fatwa"]);
});

test("FTS article references remain attached to regulation search candidates", async () => {
  const telusur = createTelusur({ peraturan: async () => ({ hasil: [{ judul: "Peraturan uji Pasal 20A", rujukan: "UU 1/2020", pasal: "Pasal 20A" }] }) });
  const result = await telusur({ rumpun: "ilmu-hukum", query: "uji", sumber: ["peraturan"] });
  assert.deepEqual(result.kandidat[0]!.rujukan, { jenis: "peraturan", rujukan: "UU 1/2020", pasal: "Pasal 20A" });
});

test("research API exposes six profiles and search without an AI key or signer", async () => {
  const app = createApiApp({ service: {} as any, telusur: createTelusur({}) });
  const profiles = await app.request("/v2/rumpun");
  assert.equal(profiles.status, 200);
  assert.equal(Object.keys((await profiles.json()).data).length, 6);
  const found = await app.request("/v2/telusur", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rumpun: "hes", query: "akad uji" }) });
  assert.equal(found.status, 200);
  assert.ok((await found.json()).data.sumber.every((x: any) => x.status === "belum_tersedia"));
  const invalid = await app.request("/v2/telusur", { method: "POST", body: JSON.stringify({ rumpun: "palsu", query: "uji" }) });
  assert.equal(invalid.status, 422);
});

test("MK BPK reference API accepts only official PDF paths with an exact case and bounded page", async () => {
  const signer = createSigner(generateSigningKey()); let opened = 0;
  const sumber = { publicKeyPem: signer.publicKeyPem, kid: signer.kid, buka: async (ref: any) => { opened++; return { rujukan: ref, status: "tidak_dapat_diperiksa" as const, potongan: [], peringatan: [] }; } };
  const app = createApiApp({ service: {} as any, signer, sumber });
  const reference = { jenis: "putusan-mk-bpk", nomor: "33/PUU-XIV/2016", url: "https://peraturan.bpk.go.id/DownloadUjiMateri/42/33_PUU-XIV_2016.pdf", halaman: 25 };
  const post = (ref: unknown) => app.request("/v2/sumber/potongan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rujukan: [ref] }) });
  assert.equal((await post(reference)).status, 200); assert.equal(opened, 1);
  for (const change of [{ url: "https://evil.example/a.pdf" }, { nomor: "33" }, { halaman: 0 }, { halaman: 601 }]) assert.equal((await post({ ...reference, ...change })).status, 422);
  assert.equal(opened, 1);
});

test("planning and screening require per-request BYOK", async () => {
  const signer = createSigner(generateSigningKey());
  const app = createApiApp({ service: {} as any, signer, makeByokModel: () => { throw new Error("Tidak boleh dipanggil tanpa kunci."); } });
  const rencana = RencanaSchema.parse({ isu: "Isu uji", subpertanyaan: ["Pertanyaan uji"], penelusuran: [{ kueri: "uji", sumber: ["fatwa"] }], kriteria: { masukkan: ["Relevan"], keluarkan: [], sertakanHistoris: false }, bagian: [{ judul: "Uji", fokus: "Uji" }] });
  for (const [path, body] of [["rencana", { rumpun: "hes", pertanyaan: "Pertanyaan uji" }], ["saring", { rencana, kandidat: [] }]] as const) {
    const response = await app.request(`/v2/laporan/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "AI_KEY_REQUIRED");
  }
});

test("screening resolves revoked and unverified evidence deterministically before AI", async () => {
  const signer = createSigner(generateSigningKey());
  const text = "Teks sintetis untuk pengujian aturan sumber yang dicatat telah dicabut.";
  const unsigned = { id: "p-uji", documentId: "uji", jenis: "peraturan" as const, judul: "Uji", rujukan: "Uji", locator: {}, text, contentHash: contentHash(text), identitas: [], lapisan: ["norma" as const], sumber: { nama: "Fixture", url: "https://example.org", otoritas: "Fixture", status: "Dicabut", diubahDengan: [], dicabutDengan: ["Dokumen pengganti uji"] }, retrievedAt: new Date().toISOString(), verificationStatus: "verified_snapshot" as const, mesin: "uji" };
  const passage: PotonganBertanda = { ...unsigned, tanda: signer.sign(signedPart(unsigned)) };
  const rencana = RencanaSchema.parse({ isu: "Isu uji", subpertanyaan: ["Pertanyaan uji"], penelusuran: [{ kueri: "uji", sumber: ["peraturan"] }], kriteria: { masukkan: ["Relevan"], keluarkan: [], sertakanHistoris: false }, bagian: [{ judul: "Uji", fokus: "Uji" }] });
  const result = await saringLaporan({ kandidat: [{ id: "lama", judul: "Lama", statusBuka: "dibuka", potongan: [passage] }, { id: "palsu", judul: "Palsu", statusBuka: "dibuka", potongan: [{ ...passage, text: "Diubah" }] }], rencana, signer, publicKeysPem: [signer.publicKeyPem], signal: AbortSignal.timeout(1000), model: { provider: "claude", model: "uji", async generate() { throw new Error("Tidak boleh memanggil AI."); } } });
  assert.deepEqual(result.hasil.map((x) => x.keputusan), ["historis", "tidak_dapat_diperiksa"]);
});

test("upload matching never accepts client text or signs an unknown document", async () => {
  const app = createApiApp({ service: {} as any, matchCorpusHash: (hash) => hash === "a".repeat(64) ? { judul: "Korpus uji", sourceUrl: "https://bphn.go.id/uji" } : null });
  const request = (body: unknown) => app.request("/v2/sumber/unggahan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await (await request({ fileHash: "b".repeat(64) })).json()).data.status, "unggahan_tidak_terverifikasi");
  const known = (await (await request({ fileHash: "a".repeat(64) })).json()).data;
  assert.equal(known.status, "hash_korpus_cocok"); assert.equal(known.potongan, undefined); assert.equal(known.tanda, undefined);
  assert.equal((await request({ fileHash: "a".repeat(64), text: "Karangan klien" })).status, 422);
});
