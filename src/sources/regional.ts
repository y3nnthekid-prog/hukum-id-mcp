import { getJson, getText, inline, decodeEntities } from "../http.js";
import { halamanPdf } from "../pdf.js";
import { contentHash, segmentPages, findArticle, type Page } from "../core/passages.js";
import { provenanceTiming } from "../core/provenance.js";
import { signedPart, type HasilBuka, type PotonganBertanda, type RujukanBuka } from "../core/sumber.js";
import type { Signer } from "../core/sign.js";
import { HUKUM_ID_VERSION } from "../version.js";
import { isMkBpkUrl, MK_NUMBER } from "../core/rujukan.js";

export function parseAceh(data: unknown) {
  const rows = (data as { data?: unknown[] })?.data;
  if (!Array.isArray(rows)) throw new Error("Struktur katalog JDIH Aceh berubah.");
  const entries = rows.flatMap((row) => {
    const html = Array.isArray(row) ? String(row[0] ?? "") : "";
    const link = html.match(/href="(https:\/\/jdih\.acehprov\.go\.id\/dih\/detail\/[a-f0-9-]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) return [];
    const judul = inline(link[2]);
    const ref = judul.match(/^(?:Qanun|Peraturan\s+Daerah)\s+Aceh\s+Nomor\s+(\d+)\s+Tahun\s+(\d{4})\b/i);
    return ref ? [{ id: link[1]!.split("/").at(-1)!, judul, nomor: ref[1]!, tahun: ref[2]!, rujukan: `Qanun Aceh ${ref[1]}/${ref[2]}`, url: link[1]!, status: null, provinsi: /Provinsi Aceh/.test(html) }] : [];
  });
  return entries.sort((a, b) => Number(b.provinsi) - Number(a.provinsi)).filter((item, index, all) => all.findIndex((x) => x.rujukan === item.rujukan) === index);
}
export async function cariQanun(query: string, limit = 10) {
  const params = new URLSearchParams({ "search[value]": kueriKatalogAceh(query), length: String(Math.min(limit * 3, 50)), start: "0" });
  return { hasil: parseAceh(await getJson(`https://jdih.acehprov.go.id/dih/jsondata?${params}`, { retries: 0 })).slice(0, limit) };
}
export function kueriKatalogAceh(query: string) {
  // Katalog lama menamai Qanun sebagai Peraturan Daerah. Identitas nomor/tahun tetap sama.
  const ref = query.trim().match(/^Qanun(?:\s+Aceh)?(?:\s+Nomor)?\s+(\d+)\s*(?:\/|Tahun\s+)(\d{4})\b/i);
  return ref ? `Nomor ${ref[1]} Tahun ${ref[2]}` : query;
}
export function parseJdihn(html: string) {
  const hasil: Array<{ id: string; judul: string; url: string; tersedia: false }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href="(\/doc\/[a-zA-Z0-9._-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const judul = inline(match[2]);
    if (judul && !hasil.some((x) => x.id === match[1])) hasil.push({ id: match[1]!, judul, url: `https://jdihn.go.id${match[1]}`, tersedia: false });
  }
  return hasil;
}
export async function cariMetadataPutusan(query: string, limit = 10) {
  // /search-api/ dilarang robots.txt. Hanya halaman publik yang boleh dibaca.
  const html = await getText(`https://jdihn.go.id/search?${new URLSearchParams({ q: query })}`, { retries: 0 });
  const hasil = parseJdihn(html).slice(0, limit);
  if (!hasil.length && !/tidak (?:ada|ditemukan)|0 (?:hasil|dokumen)/i.test(inline(html))) throw new Error("Metadata belum tersedia pada HTML publik. Tidak memanggil search-api.");
  return { hasil };
}
export async function metadataPutusan(id: string) {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) throw new Error("ID metadata tidak sah.");
  const html = await getText(`https://jdihn.go.id/doc/${id}`, { retries: 0 });
  const title = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] ?? html.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (!title) throw new Error("Judul metadata tidak dapat diperiksa.");
  return { id, judul: decodeEntities(title), url: `https://jdihn.go.id/doc/${id}`, teksPenuh: "impor_manual" };
}

export async function bukaQanun(ref: Extract<RujukanBuka, { jenis: "qanun" }>, signer: Signer): Promise<HasilBuka> {
  const match = ref.rujukan.match(/^Qanun(?: Aceh)? (\d+)\/(\d{4})$/i);
  if (!match) throw new Error("Identitas Qanun tidak sah.");
  const result = await cariQanun(`Qanun Aceh Nomor ${match[1]} Tahun ${match[2]}`, 15);
  const found = result.hasil.find((item) => item.nomor === match[1] && item.tahun === match[2]);
  if (!found) return { rujukan: ref, status: "tidak_ditemukan", potongan: [], peringatan: ["Tidak ditemukan pada katalog yang dapat dibuka, bukan pernyataan bahwa Qanun tidak pernah ada."] };
  const url = `https://jdih.acehprov.go.id/dih/download/produk-hukum/${found.id}`;
  const doc = await halamanPdf({ url_pdf: url } as any);
  const passages = segmentPages(`aceh:${found.id}`, doc.halaman as Page[]);
  const selected = ref.pasal ? [...findArticle(passages, ref.pasal).norma, ...findArticle(passages, ref.pasal).penjelasan] : passages.filter((p) => p.locator.bagian === "batang-tubuh").slice(0, 3);
  const potongan = selected.map((p): PotonganBertanda => {
    const base = { ...p, jenis: "qanun" as const, judul: found.judul, rujukan: `${ref.rujukan} ${p.locator.pasal ?? ""}`.trim(), identitas: [ref.rujukan, ...(p.locator.pasal ? [p.locator.pasal] : [])], lapisan: [p.locator.bagian === "penjelasan" ? "tafsir-resmi" as const : "norma" as const], sumber: { nama: "JDIH Aceh", url, otoritas: "Pemerintah Aceh", status: null, diubahDengan: [], dicabutDengan: [] }, ...provenanceTiming(doc), mesin: HUKUM_ID_VERSION };
    return { ...base, tanda: signer.sign(signedPart(base)) };
  });
  return { rujukan: ref, status: potongan.length ? "dibuka" : "tidak_dapat_diperiksa", potongan, peringatan: ["Berlaku khusus sesuai yurisdiksi Aceh. Status perubahan belum dikonsolidasikan dari katalog ini; jangan menyebut bunyi ini sebagai ketentuan terkini tanpa pemeriksaan tambahan."] };
}

export async function bukaMkBpk(url: string, nomor: string, signer: Signer, options: { halaman?: number; loadPdf?: (input: { url_pdf: string }) => Promise<any> } = {}) {
  if (!isMkBpkUrl(url)) throw new Error("Jalur PDF uji materi tidak sah.");
  if (!MK_NUMBER.test(nomor)) throw new Error("Nomor putusan tidak sah.");
  if (options.halaman !== undefined && (!Number.isInteger(options.halaman) || options.halaman < 1 || options.halaman > 600)) throw new Error("Halaman putusan tidak sah.");
  const doc = await (options.loadPdf ?? halamanPdf)({ url_pdf: url } as any);
  // Hanya kepala putusan, bukan nomor perkara yang dikutip di pembahasannya.
  const front = (doc.halaman as Page[]).filter(p => p.halaman <= 2).map(p => p.teks).join("\n").slice(0, 1000);
  const title = /(?:^|\n)[ \t]*PUTUSAN\s+(?:NOMOR|NO\.?)\s*:?\s*/iu.exec(front);
  const heading = title ? front.slice(title.index + title[0].length).match(/^(\d[\d\s]{0,11})\/\s*P\s*U\s*U\s*[-‐–]\s*([IVXL\s]{1,30})\/\s*([\d\s]{4,12})\s*DEMI\s+KEADILAN\b/iu) : null;
  const identity = heading ? `${heading[1]}/PUU-${heading[2]}/${heading[3]}`.replace(/\s/g, "").toUpperCase() : "";
  if (identity !== nomor.toUpperCase()) throw new Error("Nomor putusan tidak cocok dengan kepala naskah PDF BPK.");
  const pages = (doc.halaman as Page[]).filter(p => p.teks.trim() && (options.halaman === undefined || p.halaman === options.halaman)).slice(0, 8);
  return pages.map((page): PotonganBertanda => {
    const text = page.teks.slice(0, 6000);
    const base = { id: `ps_${contentHash(`${url}|${page.halaman}|${text}`).slice(0, 24)}`, documentId: `mk-bpk:${contentHash(url).slice(0, 24)}`, jenis: "putusan-mk" as const, judul: `Putusan ${nomor}`, rujukan: nomor, locator: { halamanAwal: page.halaman, halamanAkhir: page.halaman }, pageStarts: [{ halaman: page.halaman, offset: 0 }], text, contentHash: contentHash(text), identitas: [nomor], lapisan: ["tafsir-resmi" as const], sumber: { nama: "Salinan uji materi JDIH BPK RI", url, otoritas: "Mahkamah Konstitusi RI", status: null, diubahDengan: [], dicabutDengan: [] }, ...provenanceTiming(doc), mesin: HUKUM_ID_VERSION };
    return { ...base, tanda: signer.sign(signedPart(base)) };
  });
}
