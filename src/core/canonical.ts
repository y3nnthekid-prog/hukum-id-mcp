/**
 * Satu fungsi kanonikalisasi untuk potongan sumber dan kutipan.
 *
 * Validator kutipan membandingkan bentuk kanonik, tetapi sorotan dan tampilan selalu memakai teks
 * mentah. Karena itu setiap karakter kanonik membawa indeks karakter mentah asalnya (`map`),
 * sehingga temuan di bentuk kanonik bisa dipetakan kembali ke rentang mentah yang persis.
 *
 * Yang diseragamkan:
 * - Unicode NFKC dan huruf kecil;
 * - tanda hubung lunak, serta kata yang dipenggal di akhir baris ("perun-\ndangan");
 * - semua spasi dan pindah baris menjadi satu spasi;
 * - tanda kutip lengkung menjadi lurus, dan tanda pisah menjadi tanda hubung;
 * - baris kepala halaman berulang pada naskah resmi ("PRESIDEN", "REPUBLIK INDONESIA", "- 5 -");
 * - Arab: harakat, tatweel, varian alif, alif maqsurah, dan ta marbutah.
 */

export type Canonical = { text: string; map: number[] };

const HEADER_LINE =
  /^[ \t]*(?:PRESIDEN|REPUBLIK INDONESIA|PRESIDEN REPUBLIK INDONESIA|-\s*\d{1,4}\s*-|SK\s+No\.?\s*[\w.-]+|\d{4},\s*No\.\s*\d{1,4})[ \t]*$/i;

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/u;
const CHAR_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "−": "-",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ى": "ي",
  "ة": "ه",
};

/** Rentang baris kepala halaman yang dilewati, sebagai pasangan [awal, akhir) indeks mentah. */
function headerRanges(raw: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  while (start <= raw.length) {
    const end = raw.indexOf("\n", start);
    const lineEnd = end === -1 ? raw.length : end;
    if (HEADER_LINE.test(raw.slice(start, lineEnd))) ranges.push([start, lineEnd]);
    if (end === -1) break;
    start = end + 1;
  }
  return ranges;
}

export function canonicalize(raw: string): Canonical {
  const out: string[] = [];
  const map: number[] = [];
  const skip = headerRanges(raw);
  let skipIndex = 0;
  let pendingSpace = -1;

  const push = (value: string, origin: number) => {
    for (const char of value) {
      out.push(char);
      map.push(origin);
    }
  };

  for (let i = 0; i < raw.length; i += 1) {
    while (skipIndex < skip.length && skip[skipIndex]![1] <= i) skipIndex += 1;
    const range = skip[skipIndex];
    if (range && i >= range[0] && i < range[1]) continue;

    const char = raw[i]!;
    if (char === "­") continue;

    // Tanda hubung di antara dua huruf dibuang di kedua sisi perbandingan, berikut spasi atau
    // pindah baris sesudahnya. Dengan begitu "perun-\ndangan" (pemenggalan), "Undang-\nUndang",
    // dan "Undang- Undang" (lapisan OCR) semuanya sama dengan kutipan "Undang-Undang".
    if ((char === "-" || CHAR_MAP[char] === "-") && /\p{L}/u.test(raw[i - 1] ?? "")) {
      const rest = raw.slice(i + 1).match(/^[ \t]*(?:\r?\n[ \t]*)?(?=\p{L})/u);
      if (rest) {
        i += rest[0].length;
        continue;
      }
    }

    if (/\s/u.test(char)) {
      if (out.length && pendingSpace === -1) pendingSpace = i;
      continue;
    }
    if (ARABIC_MARKS.test(char)) continue;

    if (pendingSpace !== -1) {
      push(" ", pendingSpace);
      pendingSpace = -1;
    }
    const mapped = CHAR_MAP[char] ?? char;
    push(mapped.normalize("NFKC").toLocaleLowerCase("id-ID"), i);
  }
  return { text: out.join(""), map };
}

export type QuoteMatch = { start: number; end: number };

/**
 * Cari kutipan di dalam teks sumber. Mengembalikan rentang MENTAH [start, end) pada sumber, atau
 * null bila kutipan tidak ada persis (setelah kanonikalisasi yang sama di kedua sisi).
 */
export function findQuote(sourceRaw: string, quoteRaw: string): QuoteMatch | null {
  const quote = canonicalize(quoteRaw).text;
  if (!quote) return null;
  const source = canonicalize(sourceRaw);
  const at = source.text.indexOf(quote);
  if (at !== -1) return { start: source.map[at]!, end: source.map[at + quote.length - 1]! + 1 };
  // Lapisan teks PDF kadang menyisipkan spasi di tengah kata ("pembayara n Upah", "libur , hari").
  // Bila tidak cocok persis, bandingkan tanpa spasi. Rentang yang dikembalikan tetap teks mentah sumber.
  const rapatSumber = tanpaSpasi(source), rapatKutipan = quote.replace(/ /g, "");
  const di = rapatSumber.text.indexOf(rapatKutipan);
  if (di !== -1) return { start: rapatSumber.map[di]!, end: rapatSumber.map[di + rapatKutipan.length - 1]! + 1 };
  // Naskah hasil OCR tertukar pada huruf yang bentuknya mirip: "(21" untuk "(2)", "a-" untuk "a.", "I (satu)"
  // untuk "1 (satu)". Hanya pasangan mirip bentuk ini yang dimaafkan; angka yang berbeda tetap ditolak.
  const ocr = new RegExp([...rapatKutipan].map((c) => OCR_MIRIP[c] ?? c.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")).join(""), "u").exec(rapatSumber.text);
  if (!ocr) return null;
  return { start: rapatSumber.map[ocr.index]!, end: rapatSumber.map[ocr.index + ocr[0].length - 1]! + 1 };
}

const OCR_MIRIP: Record<string, string> = { "1": "[1li|]", l: "[l1i|]", i: "[il1|]", "0": "[0o]", o: "[o0]", ")": "[)1lij]", ".": "[.,-]?", ",": "[,.]?" };

function tanpaSpasi(c: Canonical): Canonical {
  const text: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < c.text.length; i += 1) {
    if (c.text[i] === " ") continue;
    text.push(c.text[i]!);
    map.push(c.map[i]!);
  }
  return { text: text.join(""), map };
}

export function wordCount(text: string) {
  return canonicalize(text).text.split(" ").filter(Boolean).length;
}
