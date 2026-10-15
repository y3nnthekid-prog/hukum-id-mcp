import { contentHash, findArticle, segmentPages, type Page, type Passage, type PassageLocator } from "./passages.js";
import { provenanceTiming } from "./provenance.js";
import type { Signature, Signer } from "./sign.js";
import { lapisanSah, type JenisSumber, type Lapisan } from "./validator.js";
import { normalizeRegulation } from "../ai/planner.js";
import { HUKUM_ID_VERSION } from "../version.js";

/**
 * Membuka rujukan menjadi potongan bertanda tangan (API v2).
 *
 * Mesin selalu membuka sumbernya sendiri lewat exact lookup; model AI tidak pernah memasok teks
 * bukti. Setiap potongan ditandatangani atas metadata dan sidik isinya, sehingga teks yang
 * dikembalikan ke mesin pada langkah sintesis bisa dibuktikan tidak diubah.
 */

type Legacy = Record<string, any>;

export type SumberAdapters = {
  inspectArticle: (input: Legacy) => Promise<Legacy>;
  regulationDetail: (id: string) => Promise<Legacy>;
  pdfPages: (input: { url_pdf: string }) => Promise<Legacy>;
  fatwaText: (input: Legacy) => Promise<Legacy>;
  khesLocation: () => Promise<Legacy | null>;
  verse: (input: Legacy) => Promise<Legacy>;
  gradedHadith: (input: Legacy) => Promise<Legacy>;
  turats: (input: Legacy) => Promise<Legacy>;
};

export type RujukanBuka =
  | { jenis: "peraturan"; rujukan: string; pasal?: string | undefined }
  | { jenis: "fatwa"; nomor: string }
  | { jenis: "khes"; pasal: string }
  | { jenis: "ayat"; surah: number; ayat: number }
  | { jenis: "hadis"; id: string }
  | { jenis: "turats"; query: string; limit?: number | undefined };

export type PotonganLocator = Partial<PassageLocator> & {
  halamanAwal?: number;
  halamanAkhir?: number;
  surah?: number;
  ayat?: number;
  hadis?: string;
  kitab?: string;
  jilid?: string | null;
  bookId?: number;
  madzhab?: string | null;
};

export type PotonganBertanda = {
  id: string;
  documentId: string;
  jenis: JenisSumber;
  judul: string;
  rujukan: string;
  locator: PotonganLocator;
  text: string;
  contentHash: string;
  identitas: string[];
  lapisan: Lapisan[];
  sumber: {
    nama: string;
    url: string;
    otoritas: string;
    status: string | null;
    diubahDengan: string[];
    dicabutDengan: string[];
    /**
     * Putusan MK yang menguji peraturan ini menurut JDIH BPK (salinan PDF resmi di BPK). Daftar ini
     * tidak lengkap; kosong bukan bukti belum pernah diuji.
     */
    ujiMateri?: Array<{ nomor: string; url: string }>;
  };
  retrievedAt: string;
  verificationStatus: "verified_live" | "verified_snapshot";
  mesin: string;
  tanda: Signature;
};

export type HasilBuka = {
  rujukan: RujukanBuka;
  status: "dibuka" | "tidak_ditemukan" | "tidak_dapat_diperiksa";
  alasan?: string;
  potongan: PotonganBertanda[];
  peringatan: string[];
};

/** Bagian potongan yang ditandatangani: semua kecuali teks (diwakili sidiknya) dan tandanya. */
export function signedPart(item: Omit<PotonganBertanda, "tanda"> | PotonganBertanda) {
  const { text: _text, tanda: _tanda, ...rest } = item as PotonganBertanda;
  return { v: 1, ...rest };
}

function idFor(prefix: string, value: string) {
  return `${prefix}_${contentHash(value).slice(0, 24)}`;
}

function relationLabels(raw: Legacy, key: string): string[] {
  const list = raw.relasi_status?.[key];
  if (!Array.isArray(list)) return [];
  return list
    .map((item: Legacy) => {
      const match = String(item.peraturan ?? "").match(/^(\w+)\s+No\.\s*(\d+)\s+Tahun\s+(\d{4})/i);
      return match ? `${match[1]!.toUpperCase() === "PERPU" ? "Perppu" : match[1]!.toUpperCase()} ${match[2]}/${match[3]}` : String(item.peraturan ?? "");
    })
    .filter(Boolean);
}

function relationIds(raw: Legacy, key: string): Array<{ id: string; label: string }> {
  const list = raw.relasi_status?.[key];
  if (!Array.isArray(list)) return [];
  return list
    .map((item: Legacy, index: number) => ({ id: String(item.id ?? ""), label: relationLabels(raw, key)[index] ?? "" }))
    .filter((item: { id: string }) => /^\d+$/.test(item.id));
}

export function createSumberService(adapters: SumberAdapters, signer: Signer) {
  function finish(base: Omit<PotonganBertanda, "tanda" | "contentHash" | "lapisan" | "mesin">): PotonganBertanda {
    const unsigned = {
      ...base,
      contentHash: contentHash(base.text),
      lapisan: lapisanSah({ jenis: base.jenis, ...(base.locator.bagian ? { bagian: base.locator.bagian } : {}) }),
      mesin: HUKUM_ID_VERSION,
    };
    return { ...unsigned, tanda: signer.sign(signedPart(unsigned)) };
  }

  async function regulationPassages(
    label: string,
    url: string,
    pasal: string | undefined,
    mengubah?: string
  ): Promise<{ passages: Passage[]; timing: ReturnType<typeof provenanceTiming> }> {
    const doc = await adapters.pdfPages({ url_pdf: url });
    const pages: Page[] = Array.isArray(doc.halaman) ? doc.halaman : [];
    const all = segmentPages(`bpk:${label}`, pages);
    const timing = provenanceTiming(doc);
    if (!pasal) return { passages: all.filter((item) => item.locator.bagian === "batang-tubuh").slice(0, 3), timing };
    const found = findArticle(all, pasal, mengubah);
    return { passages: [...found.norma, ...(mengubah ? [] : found.penjelasan)], timing };
  }

  async function openRegulation(ref: Extract<RujukanBuka, { jenis: "peraturan" }>): Promise<HasilBuka> {
    const label = normalizeRegulation(ref.rujukan) ?? ref.rujukan;
    const raw = await adapters.inspectArticle({ peraturan: label, pasal: "", sertakan_putusan_mk: false });
    if (raw.ditemukan === false || !raw.peraturan) {
      return {
        rujukan: ref,
        status: "tidak_ditemukan",
        alasan: String(raw.catatan || raw.reason || "Peraturan dengan identitas persis tidak ditemukan."),
        potongan: [],
        peringatan: [],
      };
    }
    const pdf = String(raw.peraturan.url_pdf || "");
    if (!pdf) {
      return { rujukan: ref, status: "tidak_dapat_diperiksa", alasan: "PDF resmi tidak tersedia.", potongan: [], peringatan: [] };
    }
    const status = raw.peraturan.status ? String(raw.peraturan.status) : null;
    const diubahDengan = relationLabels(raw, "Diubah dengan");
    const dicabutDengan = relationLabels(raw, "Dicabut dengan");
    const peringatan: string[] = Array.isArray(raw.peringatan) ? raw.peringatan.map(String) : [];
    const ujiMateri = (Array.isArray(raw.uji_materi_menurut_bpk) ? raw.uji_materi_menurut_bpk : [])
      .map((item: Legacy) => ({ nomor: String(item.nomor ?? "").replace(/\s+/g, ""), url: String(item.url ?? "") }))
      .filter((item: { nomor: string; url: string }) => item.nomor && item.url);
    const sumber = {
      ujiMateri,
      nama: String(raw.sumber || "JDIH BPK RI"),
      url: String(raw.peraturan.url || pdf),
      otoritas: String(raw.sumber || "JDIH BPK RI"),
      status,
      diubahDengan,
      dicabutDengan,
    };

    const original = await regulationPassages(label, pdf, ref.pasal);
    const potongan: PotonganBertanda[] = original.passages.map((passage) =>
      finish({
        id: passage.id,
        documentId: `bpk:${raw.peraturan.id}`,
        jenis: "peraturan",
        judul: String(raw.peraturan.judul || label),
        rujukan: `${label}${passage.locator.pasal ? ` ${passage.locator.pasal}` : ""}${passage.locator.bagian === "penjelasan" ? " (Penjelasan)" : ""}`,
        locator: passage.locator,
        text: passage.text,
        identitas: [label, ...(passage.locator.pasal ? [passage.locator.pasal] : [])],
        sumber: { ...sumber, url: pdf },
        ...original.timing,
      })
    );

    // Rantai perubahan: bunyi pasal sebagaimana diubah diambil dari undang-undang pengubahnya,
    // bukan dari naskah asli. Perubahan yang tidak menyentuh pasal ini tidak menghasilkan potongan.
    if (ref.pasal) {
      for (const relation of relationIds(raw, "Diubah dengan")) {
        try {
          const detail = await adapters.regulationDetail(relation.id);
          const file = (Array.isArray(detail.berkas) ? detail.berkas : []).find((item: Legacy) => item.kategori === "Peraturan");
          if (!file?.url) continue;
          const amended = await regulationPassages(relation.label, String(file.url), ref.pasal, label);
          for (const passage of amended.passages) {
            potongan.push(
              finish({
                id: passage.id,
                documentId: `bpk:${relation.id}`,
                jenis: "peraturan",
                judul: String(detail.metadata?.Judul || relation.label),
                rujukan: `${label} ${ref.pasal} sebagaimana diubah ${relation.label}`,
                locator: passage.locator,
                text: passage.text,
                identitas: [label, relation.label, ref.pasal],
                sumber: {
                  nama: "JDIH BPK RI",
                  url: String(file.url),
                  otoritas: "JDIH BPK RI",
                  status: detail.status ? String(detail.status) : null,
                  diubahDengan: [],
                  dicabutDengan: [],
                },
                ...amended.timing,
              })
            );
          }
        } catch (error) {
          peringatan.push(
            `Perubahan oleh ${relation.label} tidak dapat diperiksa (${error instanceof Error ? error.message.slice(0, 100) : "galat"}); bunyi pasal sebagaimana diubah belum dipastikan.`
          );
        }
      }
    }

    if (ref.pasal && !potongan.some((item) => item.locator.bagian === "batang-tubuh")) {
      return {
        rujukan: ref,
        status: "tidak_ditemukan",
        alasan: `${ref.pasal} tidak ditemukan sebagai judul pasal di naskah resmi ${label}.`,
        potongan: [],
        peringatan,
      };
    }
    return { rujukan: ref, status: "dibuka", potongan, peringatan };
  }

  async function openFatwa(ref: Extract<RujukanBuka, { jenis: "fatwa" }>): Promise<HasilBuka> {
    const raw = await adapters.fatwaText({ rujukan: ref.nomor, maks_karakter: 400_000 });
    const pages: Legacy[] = Array.isArray(raw.isi) ? raw.isi : [];
    const timing = provenanceTiming(raw);
    const potongan = pages
      .filter((page) => String(page.teks ?? "").trim())
      .map((page) =>
        finish({
          id: idFor("ps", `${ref.nomor}|${page.halaman}|${page.teks}`),
          documentId: `dsn:${ref.nomor}`,
          jenis: "fatwa",
          judul: `Fatwa DSN-MUI ${ref.nomor}`,
          rujukan: `Fatwa ${ref.nomor} hlm. ${page.halaman}`,
          locator: { bagian: "batang-tubuh", halamanAwal: Number(page.halaman), halamanAkhir: Number(page.halaman) },
          text: String(page.teks),
          identitas: [ref.nomor],
          sumber: {
            nama: "DSN-MUI",
            url: String(raw.url_tampilan || raw.url_pdf || ""),
            otoritas: "Dewan Syariah Nasional MUI",
            status: null,
            diubahDengan: [],
            dicabutDengan: [],
          },
          ...timing,
        })
      );
    return {
      rujukan: ref,
      status: potongan.length ? "dibuka" : "tidak_dapat_diperiksa",
      ...(potongan.length ? {} : { alasan: "Salinan fatwa tidak dapat dibaca." }),
      potongan,
      peringatan: [
        "Teks Arab pada PDF fatwa DSN memakai fon non-Unicode dan tidak dipakai sebagai kutipan; dalil diambil dari sumber ayat dan hadis.",
      ],
    };
  }

  async function openKhes(ref: Extract<RujukanBuka, { jenis: "khes" }>): Promise<HasilBuka> {
    const info = await adapters.khesLocation();
    const url = String(info?.rujukan_pdf || "");
    if (!url) {
      return { rujukan: ref, status: "tidak_dapat_diperiksa", alasan: "Naskah KHES belum diimpor.", potongan: [], peringatan: [] };
    }
    const doc = await adapters.pdfPages({ url_pdf: url });
    const found = findArticle(segmentPages("khes", Array.isArray(doc.halaman) ? doc.halaman : []), ref.pasal);
    const timing = provenanceTiming(doc);
    const potongan = found.norma.map((passage) =>
      finish({
        id: passage.id,
        documentId: "khes:2011",
        jenis: "khes",
        judul: "Kompilasi Hukum Ekonomi Syariah (Edisi Revisi 2011)",
        rujukan: `KHES ${passage.locator.pasal}`,
        locator: passage.locator,
        text: passage.text,
        identitas: ["KHES", ref.pasal],
        sumber: {
          nama: "KHES, salinan yang diimpor",
          url: String(info?.sumber || "impor lokal"),
          otoritas: "Mahkamah Agung RI (lampiran PERMA 2/2008)",
          status: null,
          diubahDengan: [],
          dicabutDengan: [],
        },
        ...timing,
      })
    );
    return {
      rujukan: ref,
      status: potongan.length ? "dibuka" : "tidak_ditemukan",
      ...(potongan.length ? {} : { alasan: `${ref.pasal} tidak terbaca sebagai judul pasal di naskah KHES.` }),
      potongan,
      peringatan: ["KHES diambil dari salinan yang diimpor, bukan dari situs resmi yang dapat dibuka otomatis."],
    };
  }

  async function openVerse(ref: Extract<RujukanBuka, { jenis: "ayat" }>): Promise<HasilBuka> {
    const raw = await adapters.verse({ surah: ref.surah, ayat: ref.ayat });
    const text = `${raw.arab ?? ""}\n${raw.terjemah ?? ""}`.trim();
    return {
      rujukan: ref,
      status: "dibuka",
      potongan: [
        finish({
          id: idFor("ps", `QS ${ref.surah}:${ref.ayat}|${text}`),
          documentId: `quran:${ref.surah}`,
          jenis: "ayat",
          judul: String(raw.rujukan || `QS ${ref.surah}:${ref.ayat}`),
          rujukan: String(raw.rujukan || `QS ${ref.surah}:${ref.ayat}`),
          locator: { surah: ref.surah, ayat: ref.ayat },
          text,
          identitas: [`QS ${ref.surah}:${ref.ayat}`],
          sumber: {
            nama: String(raw.sumber || "myquran.com"),
            url: `https://quran.com/${ref.surah}/${ref.ayat}`,
            otoritas: "Terjemahan Kemenag RI",
            status: null,
            diubahDengan: [],
            dicabutDengan: [],
          },
          ...provenanceTiming(null),
        }),
      ],
      peringatan: [],
    };
  }

  async function openHadith(ref: Extract<RujukanBuka, { jenis: "hadis" }>): Promise<HasilBuka> {
    const raw = await adapters.gradedHadith({ id: ref.id });
    const text = `${raw.arab ?? ""}\n${raw.terjemah ?? ""}`.trim();
    if (!text) return { rujukan: ref, status: "tidak_ditemukan", alasan: "Hadis tidak ditemukan.", potongan: [], peringatan: [] };
    return {
      rujukan: ref,
      status: "dibuka",
      potongan: [
        finish({
          id: idFor("ps", `hadis:${ref.id}|${text}`),
          documentId: `hadeethenc:${ref.id}`,
          jenis: "hadis",
          judul: String(raw.judul || `Hadis ${ref.id}`),
          rujukan: `Hadis ${ref.id} (${raw.derajat ?? "derajat tidak tercatat"}; ${raw.takhrij ?? "takhrij tidak tercatat"})`,
          locator: { hadis: ref.id },
          text,
          identitas: [ref.id],
          sumber: {
            nama: String(raw.sumber || "hadeethenc.com"),
            url: `https://hadeethenc.com/id/browse/hadith/${ref.id}`,
            otoritas: String(raw.derajat || "derajat tidak tercatat"),
            status: null,
            diubahDengan: [],
            dicabutDengan: [],
          },
          ...provenanceTiming(null),
        }),
      ],
      peringatan: [],
    };
  }

  async function openTurats(ref: Extract<RujukanBuka, { jenis: "turats" }>): Promise<HasilBuka> {
    const raw = await adapters.turats({ query: ref.query, limit: Math.min(ref.limit ?? 5, 10) });
    const items: Legacy[] = Array.isArray(raw.hasil) ? raw.hasil : [];
    const potongan = items
      .filter((item) => String(item.cuplikan ?? "").trim())
      .map((item) =>
        finish({
          id: idFor("ps", `turats:${item.book_id}|${item.jilid}|${item.halaman}|${item.cuplikan}`),
          documentId: `turath:${item.book_id}`,
          jenis: "turats",
          judul: String(item.kitab || "Kitab"),
          rujukan: `${item.kitab ?? "Kitab"}, ${item.penulis ?? "penulis tidak tercatat"}${item.jilid ? `, juz ${item.jilid}` : ""}${item.halaman ? `, hlm. ${item.halaman}` : ""}`,
          locator: { kitab: String(item.kitab || ""), jilid: item.jilid ?? null, bookId: Number(item.book_id), ...(item.halaman ? { halamanAwal: Number(item.halaman), halamanAkhir: Number(item.halaman) } : {}) },
          text: String(item.cuplikan),
          identitas: [String(item.kitab || "")],
          sumber: {
            nama: "api.turath.io",
            url: `https://app.turath.io/book/${item.book_id}`,
            otoritas: String(item.penulis || "penulis tidak tercatat"),
            status: null,
            diubahDengan: [],
            dicabutDengan: [],
          },
          ...provenanceTiming(null),
        })
      );
    return {
      rujukan: ref,
      status: potongan.length ? "dibuka" : "tidak_ditemukan",
      ...(potongan.length ? {} : { alasan: "Frasa tidak ditemukan di pangkalan turats." }),
      potongan,
      peringatan: Array.isArray(raw.peringatan) ? raw.peringatan.map(String) : [],
    };
  }

  async function buka(ref: RujukanBuka): Promise<HasilBuka> {
    try {
      switch (ref.jenis) {
        case "peraturan":
          return await openRegulation(ref);
        case "fatwa":
          return await openFatwa(ref);
        case "khes":
          return await openKhes(ref);
        case "ayat":
          return await openVerse(ref);
        case "hadis":
          return await openHadith(ref);
        case "turats":
          return await openTurats(ref);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = /tantangan|membatasi|HTTP 403|HTTP 429|LURING|timed out|Gagal mengambil/i.test(message);
      return {
        rujukan: ref,
        status: blocked ? "tidak_dapat_diperiksa" : "tidak_ditemukan",
        alasan: message.slice(0, 240),
        potongan: [],
        peringatan: [],
      };
    }
  }

  return { buka, publicKeyPem: signer.publicKeyPem, kid: signer.kid };
}

export type SumberService = ReturnType<typeof createSumberService>;
