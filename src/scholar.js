// Sumber: OpenAlex — katalog terbuka ~270 juta karya ilmiah, dipakai untuk
// menelusuri doktrin dan literatur hukum (termasuk jurnal hukum Indonesia).

import { getJson } from "./http.js";

const API = "https://api.openalex.org/works";
const MAILTO = "hukum-id-mcp@example.org";

function susunAbstrak(idx) {
  if (!idx) return null;
  const kata = [];
  for (const [w, posisi] of Object.entries(idx)) for (const p of posisi) kata[p] = w;
  const teks = kata.filter(Boolean).join(" ").trim();
  return teks.length > 1400 ? teks.slice(0, 1400) + " …" : teks || null;
}

export async function cariLiteratur({
  query,
  tahun_min = 0,
  tahun_maks = 0,
  hanya_akses_terbuka = false,
  bahasa = "",
  limit = 10,
} = {}) {
  const filters = [];
  if (tahun_min) filters.push(`from_publication_date:${tahun_min}-01-01`);
  if (tahun_maks) filters.push(`to_publication_date:${tahun_maks}-12-31`);
  if (hanya_akses_terbuka) filters.push("is_oa:true");
  if (bahasa) filters.push(`language:${bahasa}`);

  const qs = new URLSearchParams({
    search: query,
    per_page: String(Math.min(limit, 25)),
    mailto: MAILTO,
  });
  if (filters.length) qs.set("filter", filters.join(","));

  const data = await getJson(`${API}?${qs.toString()}`);
  return {
    sumber: "OpenAlex",
    kueri: query,
    total_temuan: data.meta?.count ?? null,
    hasil: (data.results || []).map((w) => ({
      judul: w.title,
      tahun: w.publication_year,
      penulis: (w.authorships || []).slice(0, 6).map((a) => a.author?.display_name).filter(Boolean),
      terbitan: w.primary_location?.source?.display_name || w.type,
      doi: w.doi || null,
      jumlah_sitasi: w.cited_by_count,
      akses_terbuka: w.open_access?.is_oa || false,
      url_teks_penuh: w.open_access?.oa_url || w.primary_location?.landing_page_url || null,
      bahasa: w.language || null,
      abstrak: susunAbstrak(w.abstract_inverted_index),
    })),
  };
}
