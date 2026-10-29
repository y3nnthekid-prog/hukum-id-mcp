import { DatabaseSync } from "node:sqlite";
import { canonicalize } from "../core/canonical.js";
import { segmentPages, contentHash, type Page, type Passage } from "../core/passages.js";
import { lapisanSah, type JenisSumber } from "../core/validator.js";
import { signedPart, type HasilBuka, type PotonganBertanda, type RujukanBuka } from "../core/sumber.js";
import type { Signer } from "../core/sign.js";
import { HUKUM_ID_VERSION } from "../version.js";
import type { TranscriptionProvenance } from './transcription.js';

export type CorpusMeta = { id: string; jenis: JenisSumber; judul: string; rujukan: string; sourceUrl: string; fileHash: string; retrievedAt: string; importedBy: string; anonim?: boolean; status?: string; diubahDengan?: string[]; dicabutDengan?: string[]; madzhab?: string; complete?: boolean; extractionHealth?: { status: string }; transkripsi?:TranscriptionProvenance; buku?: Array<{ buku: string; halaman: number }> };
type Stored = { meta: CorpusMeta; passage: Passage };
function tokens(query: string) {
  return [...new Set(canonicalize(query).text.match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 12);
}
// Search-only vocabulary, never a legal equivalence or a substitution in evidence.
const conceptVocabulary=[['informasi','keterangan','deskripsi'],['barang','produk'],['rusak','kerusakan']];
function expandWord(word:string){
  const vocabulary=conceptVocabulary.find(group=>group.includes(word));if(vocabulary)return vocabulary;
  const stem=word.length>6?word.replace(/^(?:meng|peng|ber|ter|per)/,'').replace(/(?:kan|nya|lah)$/,''):word;
  return [...new Set([word,...(stem.length>=3&&stem!==word?[stem]:[])])];
}
export function expandQuery(query: string) {
  return [...new Set(tokens(query).flatMap(expandWord))].slice(0,20);
}
function bodyConceptScore(query:string,{meta,passage}:Stored){
  const words=(value:string)=>canonicalize(value).text.match(/[\p{L}\p{N}]+/gu)??[];
  const body=words(passage.text),title=words(meta.judul),heading=words(passage.text.replace(/^Pasal[^\n]*\n/iu,'').split('\n')[0]??'');
  const matches=(items:string[],group:string[])=>group.some(term=>items.some(word=>word===term||(term.length>=3&&word.startsWith(term))));
  const groups=[...new Map(tokens(query).map(word=>{const group=expandWord(word);return [JSON.stringify([...group].sort()),group] as const;})).values()];
  const identity=[meta.rujukan,meta.judul].map(value=>canonicalize(value).text).some(value=>value.length>=5&&canonicalize(query).text.includes(value));
  const inquiry=canonicalize(query).text,opening=canonicalize(passage.text).text.slice(0,220);
  const asksBackground=/\b(?:definisi|pengertian|arti|asas|tujuan|tugas|fungsi|lembaga|badan|apa itu|apa (?:yang )?dimaksud)\b/u.test(inquiry);
  const productInquiry=groups.some(group=>group.some(term=>conceptVocabulary.flat().includes(term)));
  const background=/\byang dimaksud dengan\b|\bbertujuan\b|\buntuk menjalankan fungsi\b|\bpemerintah mengakui\b|\bdibentuk\b.{0,80}\b(?:badan|lembaga|komisi|dewan)\b|^pasal \S+ (?:\(\d+\) )?(?:pengawasan|pembinaan)\b/u.test(opening);
  // For product/information questions, a definition or institutional-purpose
  // preamble remains discoverable but must not outrank operative clauses just
  // by repeating the document title. Explicit background queries keep its rank.
  const penalty=productInquiry&&!asksBackground&&background?24:0;
  const asksExplanation=/\bpenjelasan\b/u.test(inquiry);
  const sectionBonus=meta.jenis==='peraturan'&&passage.locator.pasal?(asksExplanation?(passage.locator.bagian==='penjelasan'?24:0):(passage.locator.bagian==='batang-tubuh'?24:0)):0;
  const total=groups.reduce((score,group)=>{
    const inTitle=matches(title,group),inBody=matches(body,group);
    // Coverage across distinct question concepts comes first. A lone body word
    // must not outweigh the remaining question context carried by the title.
    return score+(inBody||inTitle?20:0)+(inBody?2:0)+(inBody&&!inTitle?8:0)+(matches(heading,group)?6:0);
  },(identity?1000:0)+sectionBonus-penalty);
  return total;
}

/** Korpus publik lokal. Pertanyaan, akun, dan kunci AI tidak pernah ditulis di sini. */
export class CorpusIndex {
  private db: DatabaseSync;
  constructor(filename: string, options: {readOnly?:boolean} = {}) {
    this.db = new DatabaseSync(filename,{readOnly:options.readOnly??false});
    if(!options.readOnly)this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, metadata TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS documents_hash ON documents(sha256);
      CREATE TABLE IF NOT EXISTS passages(id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, metadata TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5(id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');`);
  }
  close() { this.db.close(); }
  replace(meta: CorpusMeta, pages: Page[]) {
    if (!/^[a-f0-9]{64}$/.test(meta.fileHash) || !pages.some((p) => p.teks.trim())) throw new Error("Sidik atau teks korpus tidak sah.");
    const passages = /^putusan-/.test(meta.jenis)
      ? pages.flatMap((page) => Array.from({ length: Math.ceil(page.teks.length / 3000) }, (_, index) => {
        const text = page.teks.slice(index * 3000, (index + 1) * 3000);
        return { id: `ps_${contentHash(`${meta.id}|${page.halaman}|${index}|${text}`).slice(0, 24)}`, documentId: meta.id, text, contentHash: contentHash(text), locator: { bagian: "batang-tubuh" as const, halamanAwal: page.halaman, halamanAkhir: page.halaman }, pageStarts: [{ halaman: page.halaman, offset: 0 }] };
      })) : segmentPages(meta.id, pages);
    if (!passages.length) throw new Error("Pasal atau teks tidak terbaca.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM words WHERE id IN (SELECT id FROM passages WHERE document_id = ?)").run(meta.id);
      this.db.prepare("DELETE FROM passages WHERE document_id = ?").run(meta.id);
      this.db.prepare("INSERT OR REPLACE INTO documents VALUES (?, ?, ?)").run(meta.id, meta.fileHash, JSON.stringify(meta));
      const insert = this.db.prepare("INSERT INTO passages VALUES (?, ?, ?)");
      const fts = this.db.prepare("INSERT INTO words VALUES (?, ?)");
      for (const passage of passages) {
        insert.run(passage.id, meta.id, JSON.stringify({ meta, passage }));
        fts.run(passage.id, canonicalize(`${meta.judul} ${passage.text}`).text);
      }
      this.db.exec("COMMIT");
    } catch (cause) { this.db.exec("ROLLBACK"); throw cause; }
    return { id: meta.id, fileHash: meta.fileHash, jumlahPotongan: passages.length };
  }
  search(query: string, jenis?: string, limit = 15) {
    const count = Number(this.db.prepare("SELECT count(*) AS n FROM documents WHERE (? IS NULL OR json_extract(metadata, '$.jenis') = ?)").get(jenis ?? null, jenis ?? null)?.n ?? 0);
    if (!count) return { tersedia: false, hasil: [], perluasan: [] };
    const terms = expandQuery(query);
    if (!terms.length) return { tersedia: true, hasil: [], perluasan: [] };
    const expression = terms.map((word) => `"${word.replace(/"/g, '""')}"*`).join(" OR ");
    const rows = this.db.prepare("SELECT passages.metadata FROM words JOIN passages ON passages.id=words.id WHERE words MATCH ? AND (? IS NULL OR json_extract(passages.metadata, '$.meta.jenis') = ?) ORDER BY bm25(words) LIMIT ?").all(expression, jenis ?? null, jenis ?? null, 200);
    const seen=new Map<string,string>();
    const hasil = rows.map((row,index) => ({stored:JSON.parse(String(row.metadata)) as Stored,index})).filter(({stored}) => !jenis || stored.meta.jenis === jenis).map(row=>({...row,score:bodyConceptScore(query,row.stored)})).sort((a,b)=>b.score-a.score||a.index-b.index).filter(({stored})=>{
      if(stored.meta.jenis!=='peraturan'||!stored.passage.locator.pasal)return true;
      const key=JSON.stringify([stored.meta.id,stored.passage.locator.pasal,stored.passage.locator.mengubah??null]),section=stored.passage.locator.bagian,previous=seen.get(key);
      if((previous==='batang-tubuh'&&section==='penjelasan')||(previous==='penjelasan'&&section==='batang-tubuh'))return false;
      if(!previous)seen.set(key,section);return true;
    }).slice(0,Math.min(50,Math.max(1,limit))).map(({stored})=>stored).map(({ meta, passage }) => ({ id: meta.id, judul: `${meta.judul}${passage.locator.pasal ? `, ${passage.locator.pasal}` : ""}`, rujukan: meta.rujukan, pasal: passage.locator.pasal, cuplikan: passage.text.slice(0, 600), url: meta.sourceUrl, status: meta.status ?? null, madzhab: meta.madzhab ?? null, fileHash: meta.fileHash }));
    return { tersedia: true, hasil, perluasan: terms };
  }
  byHash(hash: string): CorpusMeta | null {
    const row = this.db.prepare("SELECT metadata FROM documents WHERE sha256 = ? LIMIT 1").get(hash);
    return row ? JSON.parse(String(row.metadata)) as CorpusMeta : null;
  }
  open(ref: RujukanBuka, signer: Signer): HasilBuka {
    if (!["khi", "khes", "qanun", "peraturan", "putusan"].includes(ref.jenis)) return { rujukan: ref, status: "tidak_dapat_diperiksa", potongan: [], peringatan: [] };
    const filter = ref.jenis === "putusan" ? null : ref.jenis;
    const identity = ref.jenis === "putusan" ? ref.id : ref.jenis === "qanun" || ref.jenis === "peraturan" ? ref.rujukan.toLowerCase() : "";
    const article = "pasal" in ref ? ref.pasal?.toLowerCase() : undefined;
    const conditions = "(? IS NULL OR json_extract(metadata, '$.meta.jenis') = ?) AND (? = '' OR lower(json_extract(metadata, '$.meta.rujukan')) = ? OR json_extract(metadata, '$.meta.id') = ?)" + (ref.jenis === "putusan" ? " AND json_extract(metadata, '$.meta.jenis') IN ('putusan-ma', 'putusan-mk')" : "");
    const bindings = [filter, filter, identity, identity, identity];
    const coverage = this.db.prepare(`SELECT count(*) AS n, min(coalesce(json_extract(metadata, '$.meta.complete'), 0)) AS complete FROM passages WHERE ${conditions}`).get(...bindings);
    const complete = Number(coverage?.n ?? 0) > 0 && Number(coverage?.complete) === 1;
    const selected = this.db.prepare(`SELECT metadata FROM passages WHERE ${conditions} AND (? IS NULL OR lower(json_extract(metadata, '$.passage.locator.pasal')) = ?) LIMIT ?`).all(...bindings, article ?? null, article ?? null, article ? 8 : 4).map((row) => JSON.parse(String(row.metadata)) as Stored);
    const potongan = selected.map(({ meta, passage }): PotonganBertanda => {
      const base = { ...passage, jenis: meta.jenis, judul: meta.judul, rujukan: `${meta.rujukan}${passage.locator.pasal ? ` ${passage.locator.pasal}` : ""}`, identitas: [meta.rujukan, ...(passage.locator.pasal ? [passage.locator.pasal] : [])], lapisan: lapisanSah({ jenis: meta.jenis, bagian: passage.locator.bagian }), sumber: { nama: meta.sourceUrl, url: meta.sourceUrl, otoritas: "Salinan sumber resmi yang diimpor", status: meta.status ?? null, diubahDengan: meta.diubahDengan ?? [], dicabutDengan: meta.dicabutDengan ?? [] }, retrievedAt: meta.retrievedAt, verificationStatus: "verified_snapshot" as const, mesin: HUKUM_ID_VERSION };
      const withProvenance={...base,...(meta.transkripsi?{transkripsi:meta.transkripsi}:{})};
      return { ...withProvenance, tanda: signer.sign(signedPart(withProvenance)) };
    });
    return { rujukan: ref, status: potongan.length ? "dibuka" : complete ? "tidak_ditemukan" : "tidak_dapat_diperiksa", potongan, peringatan: ["Salinan korpus adalah snapshot. Periksa perubahan dan status terbaru pada sumber resmi.", ...(!complete ? ["Kelengkapan ekstraksi belum dikonfirmasi; pasal yang tidak terbaca belum membuktikan ketidakadaan."] : [])] };
  }
}
