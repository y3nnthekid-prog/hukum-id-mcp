import assert from "node:assert/strict";
import test from "node:test";
import { CorpusIndex } from "../src/indexing/corpus.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";
import { signedPart } from "../src/core/sumber.js";
import { CorpusManifest } from "../src/indexing/manifest.js";
import { inspectKhiBooks } from "../src/indexing/import.js";
import { validateTranscription } from '../src/indexing/transcription.js';
import { contentHash } from '../src/core/passages.js';
import {readFileSync} from 'node:fs';

test('reviewed preview source extracts bind both reviews and retain the corrected operative text', () => {
  const root=new URL('../docs/corpus-reviewed/2026-10-20/',import.meta.url);
  const load=(name:string,total:number)=>{
    const raw=JSON.parse(readFileSync(new URL(name+'.json',root),'utf8'));
    return validateTranscription(raw,raw.sourceHash,total,false);
  };
  const uu=load('uu-27-2022-pasal46',50);
  assert.deepEqual(uu.provenance.sourcePages,[19,19]);
  assert.match(uu.pages[0]!.teks,/wajib menyampaikan/);
  assert.match(uu.pages[0]!.teks,/3 x 24/);
  assert.doesNotMatch(uu.pages[0]!.teks,/Pasal 4[578]/);
  const original=load('perma-2-2015',15),amender=load('perma-4-2019',8),qanun=load('qanun-12-2025',20);
  assert.equal(original.pages.length,15);assert.equal(amender.pages.length,8);assert.equal(qanun.pages.length,20);
  assert.match(original.pages.map(p=>p.teks).join('\n'),/Pasal 24[\s\S]*?kepada/);
  assert.match(amender.pages.map(p=>p.teks).join('\n'),/Rp500\.000\.000,00/);
  assert.match(qanun.pages.find(p=>p.halaman===14)!.teks,/Pasal 74A[\s\S]*?dicabut dan dinyatakan tidak berlaku/);
  assert.equal(qanun.provenance.reviews.length,2);
});

test('curated KHI requires original binding, every body page and two content-bound reviews', () => {
  const pages=khiFixture().slice(0,3).map(p=>({...p,imageHash:'a'.repeat(64)}));
  const textHash=contentHash(JSON.stringify(pages));
  const review=(pass:number)=>({pass,reviewer:`AI pass ${pass}`,reviewedAt:'2026-10-20T00:00:00Z',textHash,sourceHash:'b'.repeat(64),issues:[]});
  const input={v:1,sourceHash:'b'.repeat(64),sourcePages:[1,3],pages,reviews:[review(1),review(2)]};
  assert.equal(validateTranscription(input,'b'.repeat(64),4,true).provenance.reviewKind,'telaah AI berbasis sumber');
  assert.throws(()=>validateTranscription(input,'c'.repeat(64),4,true),/SOURCE_HASH/);
  assert.throws(()=>validateTranscription({...input,reviews:[review(1)]},'b'.repeat(64),4,true));
  assert.throws(()=>validateTranscription({...input,pages:pages.filter(p=>p.halaman!==2)},'b'.repeat(64),4,true));
  const changed=structuredClone(input);changed.pages[0]!.teks+='teks diubah';
  assert.throws(()=>validateTranscription(changed,'b'.repeat(64),4,true),/REVIEW_HASH/);
  const missing=structuredClone(input);missing.pages[0]!.teks=missing.pages[0]!.teks.replace('Pasal 124\nIsi sintetis perkawinan untuk uji.\n','');
  const changedHash=contentHash(JSON.stringify(missing.pages));missing.reviews.forEach(r=>r.textHash=changedHash);
  assert.throws(()=>validateTranscription(missing,'b'.repeat(64),4,true),/KHI_ARTICLE_COVERAGE/);
});

function khiFixture() {
  return [
    { halaman: 1, teks: "KOMPILASI HUKUM ISLAM\nBUKU I\nHUKUM PERKAWINAN\n" + Array.from({ length: 170 }, (_, i) => `Pasal ${i + 1}\nIsi sintetis perkawinan untuk uji.\n`).join("") },
    { halaman: 2, teks: "BUKU II\nHUKUM KEWARISAN\n" + Array.from({ length: 44 }, (_, i) => `Pasal ${i + 171}\nIsi sintetis kewarisan untuk uji.\n`).join("") },
    { halaman: 3, teks: "BUKU III\nHUKUM PERWAKAFAN\n" + Array.from({ length: 15 }, (_, i) => `Pasal ${i + 215}\nIsi sintetis perwakafan untuk uji.\n`).join("") },
    { halaman: 4, teks: "PENJELASAN\nATAS KOMPILASI\nPasal 124\nPenjelasan sintetis, bukan pengganti pasal batang tubuh.\n" },
  ];
}

test("KHI book audit accepts the complete ordered body and excludes explanation headings", () => {
  assert.deepEqual(inspectKhiBooks(khiFixture()), [{ buku: "I", halaman: 1 }, { buku: "II", halaman: 2 }, { buku: "III", halaman: 3 }]);
});

test("KHI book audit rejects missing articles even when explanation contains the number", () => {
  const pages = khiFixture(); pages[0]!.teks = pages[0]!.teks.replace("Pasal 124\nIsi sintetis perkawinan untuk uji.\n", "");
  assert.throws(() => inspectKhiBooks(pages), /KHI_ARTICLE_COVERAGE/);
  const sameLine = khiFixture(); sameLine[2]!.teks = sameLine[2]!.teks.replace("Pasal 229\nIsi sintetis perwakafan untuk uji.\n", ""); sameLine[3]!.teks = "PENJELASAN ATAS KOMPILASI HUKUM ISLAM\nPasal 229\nCukup jelas.";
  assert.throws(() => inspectKhiBooks(sameLine), /KHI_ARTICLE_COVERAGE/);
});

test("KHI book audit rejects contents-only copies, duplicated articles, and wrong book boundaries", () => {
  assert.throws(() => inspectKhiBooks([{ halaman: 1, teks: "KOMPILASI HUKUM ISLAM\nBUKU I\nBUKU II\nBUKU III\nDaftar isi saja." }]), /KHI_/);
  const duplicate = khiFixture(); duplicate[0]!.teks += "Pasal 170\nSalinan ganda.\n";
  assert.throws(() => inspectKhiBooks(duplicate), /KHI_ARTICLE_COVERAGE/);
  const shifted = khiFixture(); shifted[0]!.teks = shifted[0]!.teks.replace("Pasal 170\nIsi sintetis perkawinan untuk uji.\n", ""); shifted[1]!.teks = shifted[1]!.teks.replace("HUKUM KEWARISAN\n", "HUKUM KEWARISAN\nPasal 170\nIsi sintetis dipindah ke buku yang salah.\n");
  assert.throws(() => inspectKhiBooks(shifted), /KHI_BOOK_BOUNDARY/);
  const ocrShifted = khiFixture(); ocrShifted[0]!.teks = ocrShifted[0]!.teks.replace("Pasal 170\nIsi sintetis perkawinan untuk uji.\n", ""); ocrShifted[1]!.teks = ocrShifted[1]!.teks.replace("HUKUM KEWARISAN\n", "HUKUM KEWARISAN\nPasai 170\nIsi sintetis dipindah ke buku yang salah.\n");
  assert.throws(() => inspectKhiBooks(ocrShifted), /KHI_BOOK_BOUNDARY/);
  const contents = khiFixture(); contents[0]!.teks = "DAFTAR ISI\n" + contents[0]!.teks;
  assert.throws(() => inspectKhiBooks(contents), /KHI_CONTENTS_REVIEW/);
  const pagination = khiFixture().map(page => ({ ...page, teks: page.teks.replace(/Isi sintetis (?:perkawinan|kewarisan|perwakafan) untuk uji\./g, "12") }));
  assert.throws(() => inspectKhiBooks(pagination), /KHI_ARTICLE_COVERAGE/);
  const empty = khiFixture(); empty[0]!.teks = empty[0]!.teks.replace("Pasal 124\nIsi sintetis perkawinan untuk uji.\n", "Pasal 124\n");
  assert.throws(() => inspectKhiBooks(empty), /KHI_ARTICLE_COVERAGE/);
  for (const [page, number, content] of [[0, 170, "perkawinan"], [1, 214, "kewarisan"]] as const) {
    const boundaryEmpty = khiFixture(); boundaryEmpty[page]!.teks = boundaryEmpty[page]!.teks.replace(`Pasal ${number}\nIsi sintetis ${content} untuk uji.\n`, `Pasal ${number}\n`);
    assert.throws(() => inspectKhiBooks(boundaryEmpty), /KHI_ARTICLE_COVERAGE/);
  }
});

test("CLI manifest preserves reviewed status and completeness instead of silently dropping them", () => {
  const manifest = { id: "qanun-uji", jenis: "qanun", judul: "Judul sintetis", rujukan: "Qanun Aceh 7/2013", sourceUrl: "https://jdih.acehprov.go.id/uji.pdf", retrievedAt: "2026-10-16T00:00:00Z", importedBy: "fixture", file: "uji.pdf", status: "Berlaku", complete: false };
  assert.deepEqual(CorpusManifest.parse(manifest), manifest);
  assert.throws(() => CorpusManifest.parse({ ...manifest, complete: "true" }));
  assert.throws(() => CorpusManifest.parse({ ...manifest, typo_status: "Berlaku" }));
});

test("FTS indexes originals, normalizes Arabic, binds hostile queries, and signs only stored text", () => {
  const corpus = new CorpusIndex(":memory:");
  try {
    corpus.replace({ id: "khi-uji", jenis: "khi", judul: "Korpus sintetis", rujukan: "KHI", sourceUrl: "https://bphn.go.id/uji.pdf", fileHash: "a".repeat(64), retrievedAt: "2026-10-16T00:00:00.000Z", importedBy: "fixture", complete: true }, [{ halaman: 1, teks: "BUKU I\nPasal 1\nTeks sintetis perkawinan dan lafaz الضَّرَرُ يُزَالُ untuk pengujian." }]);
    assert.equal(corpus.search("الضرر يزال").hasil.length, 1);
    assert.doesNotThrow(() => corpus.search('" OR 1=1; DROP TABLE passages; --'));
    assert.equal(corpus.search("perkawinan").hasil.length, 1);
    const signer = createSigner(generateSigningKey());
    const opened = corpus.open({ jenis: "khi", pasal: "Pasal 1" }, signer);
    assert.equal(opened.status, "dibuka");
    assert.deepEqual(opened.potongan[0]!.lapisan, ["pedoman"]);
    assert.ok(verifySignature(signedPart(opened.potongan[0]!), opened.potongan[0]!.tanda, [signer.publicKeyPem]));
    assert.equal(corpus.byHash("b".repeat(64)), null);
    assert.ok(corpus.byHash("a".repeat(64)));
    assert.equal(corpus.open({ jenis: "khi", pasal: "Pasal 9999" }, signer).status, "tidak_ditemukan");
  } finally { corpus.close(); }
});
test('source discovery ranks distinct body concepts above repeated document-title boilerplate',()=>{
 const corpus=new CorpusIndex(':memory:');
 try{
  const boilerplate=Array.from({length:60},(_,i)=>`Pasal ${i+1}\nBadan perlindungan konsumen mengatur lembaga perlindungan konsumen dan pembinaan perlindungan konsumen.\n`).join('');
  const operative='Pasal 61\nPelaku usaha memberi informasi tentang kondisi barang yang ditawarkan kepada konsumen.\n';
  corpus.replace({id:'ranking-fixture',jenis:'peraturan',judul:'Peraturan Perlindungan Konsumen',rujukan:'UU 999/2099',sourceUrl:'https://example.test/fixture.pdf',fileHash:'e'.repeat(64),retrievedAt:'2026-10-24T00:00:00Z',importedBy:'fixture'},[{halaman:1,teks:boilerplate+operative}]);
  const found=corpus.search('perlindungan konsumen keterangan produk','peraturan',8);
  assert.equal(found.hasil[0]?.pasal,'Pasal 61');assert.ok(found.perluasan.includes('informasi'));assert.ok(found.perluasan.includes('barang'));assert.equal(found.hasil.length,8);
  assert.ok(found.hasil[0]?.cuplikan.includes('informasi tentang kondisi barang'));assert.ok(!found.hasil[0]?.cuplikan.includes('keterangan produk'));
  assert.equal(corpus.search('perlindungan konsumen barang berbeda','peraturan',8).hasil[0]?.pasal,'Pasal 61');
 }finally{corpus.close();}
});
test('search aliases count once per concept and exact document titles retain their identity',()=>{
 const corpus=new CorpusIndex(':memory:');
 try{
  const meta={id:'concepts',jenis:'peraturan' as const,judul:'Aturan Sintetis Pengujian',rujukan:'UU 998/2099',sourceUrl:'https://example.test/concepts.pdf',fileHash:'f'.repeat(64),retrievedAt:'2026-10-24T00:00:00Z',importedBy:'fixture'};
  corpus.replace(meta,[{halaman:1,teks:'Pasal 1\nBarang.\nPasal 2\nInformasi.\n'}]);
  const ids=(q:string)=>corpus.search(q,'peraturan',8).hasil.map(x=>x.pasal);
  assert.deepEqual(ids('produk informasi'),ids('produk informasi keterangan deskripsi'));
  assert.equal(corpus.search(meta.judul,'peraturan',8).hasil[0]?.id,'concepts');
 }finally{corpus.close();}
});

test('discovery balances the full question context against an isolated matching damage word',()=>{
 const corpus=new CorpusIndex(':memory:');
 try{
  const base={jenis:'peraturan' as const,sourceUrl:'https://example.test/discovery.pdf',fileHash:'e'.repeat(64),retrievedAt:'2026-10-24T00:00:00Z',importedBy:'fixture'};
  corpus.replace({...base,id:'context',judul:'Aturan Perlindungan Konsumen',rujukan:'UU 995/2099'},[{halaman:1,teks:'Pasal 11\nPelaku usaha menanggung kerusakan barang yang dialami konsumen menurut syarat yang ditentukan.\nPasal 12\nKewajiban konsumen membaca petunjuk barang.\n'}]);
  corpus.replace({...base,id:'other-context',judul:'Aturan Penitipan',rujukan:'UU 994/2099'},[{halaman:1,teks:'Pasal 20\nBarang rusak dalam penitipan tunduk pada ketentuan penitipan.\n'}]);
  const result=corpus.search('perlindungan konsumen barang rusak','peraturan',8);
  assert.equal(result.hasil[0]?.pasal,'Pasal 11');assert.equal(result.hasil[0]?.id,'context');
  assert.ok(result.perluasan.includes('kerusakan'));assert.match(result.hasil[0]!.cuplikan,/kerusakan/);
  assert.deepEqual(corpus.search('barang rusak','peraturan').hasil.map(p=>p.pasal),corpus.search('barang rusak kerusakan','peraturan').hasil.map(p=>p.pasal));
  const opened=corpus.open({jenis:'peraturan',rujukan:'UU 995/2099',pasal:'Pasal 11'},createSigner(generateSigningKey()));
  assert.match(opened.potongan[0]!.text,/kerusakan/);assert.doesNotMatch(opened.potongan[0]!.text,/\brusak\b/);
 }finally{corpus.close();}
});
test('a regulation article uses one discovery slot while its original body and explanation stay openable',()=>{
 const corpus=new CorpusIndex(':memory:');
 try{
  corpus.replace({id:'layers-ranking',jenis:'peraturan',judul:'Peraturan Informasi Barang',rujukan:'UU 997/2099',sourceUrl:'https://example.test/layers.pdf',fileHash:'d'.repeat(64),retrievedAt:'2026-10-24T00:00:00Z',importedBy:'fixture',complete:true},[{halaman:1,teks:'Pasal 1\nHak konsumen adalah informasi mengenai barang.\nPasal 2\nPelaku usaha memberi keterangan produk.\n'},{halaman:2,teks:'PENJELASAN\nII. PASAL DEMI PASAL\nPasal 1\nInformasi barang informasi barang informasi barang adalah penjelasan sintetis.\nPasal 2\nKeterangan produk adalah penjelasan sintetis.\n'}]);
  const found=corpus.search('informasi barang','peraturan',8).hasil;
  const articleHits=found.filter(x=>x.pasal);assert.equal(new Set(articleHits.map(x=>x.pasal)).size,articleHits.length);assert.match(articleHits.find(x=>x.pasal==='Pasal 1')!.cuplikan,/Hak konsumen/);
  const opened=corpus.open({jenis:'peraturan',rujukan:'UU 997/2099',pasal:'Pasal 1'},createSigner(generateSigningKey()));assert.ok(opened.potongan.some(p=>p.locator.bagian==='batang-tubuh'));assert.ok(opened.potongan.some(p=>p.locator.bagian==='penjelasan'));
 }finally{corpus.close();}
});
test('discovery does not collapse separate amended-law owners sharing an article number',()=>{
 const corpus=new CorpusIndex(':memory:');
 try{
  corpus.replace({id:'owners-ranking',jenis:'peraturan',judul:'Perubahan Sintetis',rujukan:'UU 996/2099',sourceUrl:'https://example.test/owners.pdf',fileHash:'c'.repeat(64),retrievedAt:'2026-10-24T00:00:00Z',importedBy:'fixture'},[{halaman:1,teks:'Pasal 15\nBeberapa ketentuan dalam Undang-Undang Nomor 999 Tahun 2099 tentang Satu diubah sebagai berikut:\n1. Ketentuan Pasal 26 diubah sehingga berbunyi sebagai berikut:\nPasal 26\nKegiatan perbankan sintetis.\n'},{halaman:2,teks:'Pasal 16\nBeberapa ketentuan dalam Undang-Undang Nomor 998 Tahun 2099 tentang Dua diubah sebagai berikut:\n1. Ketentuan Pasal 26 diubah sehingga berbunyi sebagai berikut:\nPasal 26\nKegiatan perdagangan sintetis.\n'}]);
  const found=corpus.search('kegiatan sintetis','peraturan',8).hasil.filter(x=>x.pasal==='Pasal 26');assert.equal(found.length,2);assert.notEqual(found[0]!.cuplikan,found[1]!.cuplikan);
 }finally{corpus.close();}
});

test("reviewed amendment relationships survive manifest import and are covered by the passage signature", () => {
  const manifest = CorpusManifest.parse({ id: "qanun-relasi", jenis: "qanun", judul: "Naskah sintetis historis", rujukan: "Qanun Aceh 6/2014", sourceUrl: "https://jdih.acehprov.go.id/uji.pdf", retrievedAt: "2026-10-18T00:00:00Z", importedBy: "fixture", file: "uji.pdf", status: "Diubah", diubahDengan: ["Qanun Aceh 12/2025"], dicabutDengan: [] });
  assert.deepEqual(manifest.diubahDengan, ["Qanun Aceh 12/2025"]);
  const corpus = new CorpusIndex(":memory:"); const signer = createSigner(generateSigningKey());
  try {
    const { file: _file, ...meta } = manifest;
    corpus.replace({ ...meta, fileHash: "e".repeat(64) }, [{ halaman: 1, teks: "Pasal 1\nTeks asli, belum dikonsolidasikan." }]);
    const opened = corpus.open({ jenis: "qanun", rujukan: "Qanun Aceh 6/2014", pasal: "Pasal 1" }, signer);
    const passage = opened.potongan[0]!;
    assert.deepEqual(passage.sumber.diubahDengan, ["Qanun Aceh 12/2025"]);
    assert.ok(verifySignature(signedPart(passage), passage.tanda, [signer.publicKeyPem]));
    passage.sumber.diubahDengan = [];
    assert.equal(verifySignature(signedPart(passage), passage.tanda, [signer.publicKeyPem]), false);
  } finally { corpus.close(); }
});

test("partial extraction cannot prove absence and a regulation cannot be opened as a decision", () => {
  const corpus = new CorpusIndex(":memory:");
  const signer = createSigner(generateSigningKey());
  try {
    corpus.replace({ id: "partial", jenis: "khi", judul: "Uji", rujukan: "KHI", sourceUrl: "https://bphn.go.id/uji", fileHash: "d".repeat(64), retrievedAt: new Date().toISOString(), importedBy: "fixture", complete: false }, [{ halaman: 1, teks: "Pasal 1\nTeks yang terbaca sebagian" }]);
    assert.equal(corpus.open({ jenis: "khi", pasal: "Pasal 2" }, signer).status, "tidak_dapat_diperiksa");
    assert.equal(corpus.open({ jenis: "putusan", id: "partial" }, signer).status, "tidak_dapat_diperiksa");
  } finally { corpus.close(); }
});

test("corpus replacement is atomic and removes old FTS rows", () => {
  const corpus = new CorpusIndex(":memory:");
  const meta = { id: "uji", jenis: "peraturan" as const, judul: "Uji", rujukan: "Uji", sourceUrl: "https://peraturan.bpk.go.id/uji.pdf", fileHash: "c".repeat(64), retrievedAt: new Date().toISOString(), importedBy: "fixture" };
  try {
    corpus.replace(meta, [{ halaman: 1, teks: "Pasal 1\nIsi pertama" }]);
    corpus.replace(meta, [{ halaman: 1, teks: "Pasal 1\nIsi kedua" }]);
    assert.equal(corpus.search("pertama").hasil.length, 0);
    assert.equal(corpus.search("kedua").hasil.length, 1);
    assert.throws(() => corpus.replace(meta, [{ halaman: 1, teks: "" }]), /teks|pasal/i);
    assert.equal(corpus.search("kedua").hasil.length, 1);
  } finally { corpus.close(); }
});
