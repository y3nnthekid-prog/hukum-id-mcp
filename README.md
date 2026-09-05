# HukumID Research Platform

Platform evidence-first untuk riset hukum Indonesia dan Hukum Ekonomi Syariah (HES).
Satu legal core melayani Web, REST API v1, MCP lokal `stdio`, dan remote MCP Streamable HTTP.
Sistem menolak klaim tanpa evidence dan gagal tertutup ketika rujukan exact ambigu atau tidak ada.

Versi 0.6 adalah fondasi pilot: Web search workspace, 10 MCP tool, REST API, upload terenkripsi,
AI evidence-first opsional, release indeks atomik, Azure IaC, CI/canary/rollback, dan telemetri
privacy-first sudah tersedia. Label production-ready tetap menunggu quality gates ahli dan corpus
yang dirinci di [launch readiness](docs/launch-readiness.md).

## Jalankan lokal

Butuh Node.js 22 atau lebih baru dan `curl` pada PATH.

```bash
npm ci
npm run start:api       # http://localhost:3001
npm run dev:web         # http://localhost:3000
```

Konfigurasi tersedia di [.env.example](.env.example). Azure menggunakan Managed Identity atau
`DefaultAzureCredential`; jangan menaruh Storage connection string di repository.

Dokumentasi utama: [arsitektur](docs/architecture.md), [OpenAPI](openapi.yaml),
[deployment Azure](docs/deployment.md), dan [runbook alert](docs/runbooks/alerts.md).

## Sumber

| Sumber | Dipakai untuk |
|---|---|
| JDIH BPK RI (`peraturan.bpk.go.id`) | Peraturan pusat dan daerah, status keberlakuan, relasi antarperaturan, PDF resmi |
| Direktori Putusan MA (`putusan3.mahkamahagung.go.id`) | Putusan Mahkamah Agung dan pengadilan di bawahnya |
| Mahkamah Konstitusi (`mkri.id`) | Putusan PUU, SKLN, PHPU, PHPKADA |
| OpenAlex (`api.openalex.org`) | Literatur ilmiah dan doktrin |
| JDIH Mahkamah Agung (`jdih.mahkamahagung.go.id`) | PERMA, SEMA, KMA — termasuk KHES (PERMA 2/2008) dan PERMA 14/2016 |
| DSN-MUI (`dsnmui.or.id`) | Seluruh fatwa Dewan Syariah Nasional, terindeks dan dapat dicari |
| myquran.com dan quran.com | Ayat Al-Quran dan hadis: teks Arab Unicode, transliterasi, terjemahan |
| hadeethenc.com | Ensiklopedia Hadis Nabawi: derajat kesahihan, takhrij, syarah, faedah — berbahasa Indonesia |
| api.turath.io | Kitab turats untuk memverifikasi redaksi kaidah fikih; kutipan dibatasi pendek dan selalu bersitasi |

## MCP default

Default MCP sengaja dibatasi menjadi sepuluh tool yang tidak tumpang tindih:

| Tool | Fungsi |
|---|---|
| `search_legal_sources` | Cari kandidat dari sumber hukum nasional, HES, putusan, dan literatur |
| `get_legal_document` | Ambil satu dokumen dari rujukan persis |
| `lookup_article` | Cari bunyi pasal beserta locator dan provenance; fail-closed |
| `verify_citation` | Periksa sitasi di dalam draf |
| `trace_regulation` | Telusuri perubahan dan keberlakuan pada tanggal tertentu |
| `search_jurisprudence` | Cari putusan MA/MK dengan status sumber eksplisit |
| `research_sharia_issue` | Petakan isu/akad ke fatwa, regulasi, KHES, dalil, dan putusan |
| `analyze_legal_problem` | Analisis yang abstain jika evidence belum cukup |
| `analyze_uploaded_document` | Periksa dokumen pengguna sebagai data tidak tepercaya |
| `get_source_status` | Tampilkan freshness, kegagalan, dan keterbatasan sumber |

Tool lama hanya dimuat bila `HUKUM_MCP_LEGACY=1` dan akan dihapus pada major version berikutnya.

## Tool legacy (opt-in)

| Tool | Fungsi |
|---|---|
| `cari_peraturan` | Cari peraturan berdasarkan kata kunci, nomor, tahun, jenis, entitas |
| `detail_peraturan` | Metadata lengkap, STATUS berlaku/dicabut, relasi (Mencabut, Diubah dengan, ...), uji materi MK, tautan PDF |
| `teks_peraturan` | Unduh PDF resmi lalu ekstrak teksnya; bisa disaring per halaman atau per kata kunci |
| `kategori_putusan_ma` | Daftar slug kategori perkara di Direktori Putusan MA |
| `telusuri_putusan_ma` | Telusuri putusan MA per kategori dan tahun |
| `detail_putusan_ma` | Metadata satu putusan MA plus tautan PDF/ZIP |
| `cari_putusan_mk` | Cari putusan MK, lengkap dengan amar dan tautan salinan |
| `cari_literatur_hukum` | Cari jurnal, buku, dan bab buku ilmiah lewat OpenAlex |
| `cari_perma` | Cari PERMA/SEMA/KMA di JDIH MA (JDIH BPK tidak mengindeksnya) |
| **`periksa_pasal`** | **Alur utama.** Satu panggilan: identitas, status, relasi, kutipan verbatim pasal, silang-periksa MK, dan peringatan otomatis |
| **`cari_dalam_pdf`** | Cari frasa di seluruh isi satu PDF, kembalikan cuplikan berkonteks dan nomor halaman |
| **`sisir_putusan_mk`** | Periksa sampai 25 putusan MK sekaligus dan hitung kemunculan kata kunci di tiap salinan |
| **`riset_akad_syariah`** | Titik masuk dua perspektif: fatwa DSN, peraturan positif, dan putusan ekonomi syariah, paralel |
| `cari_pasal_khes`, `impor_khes` | Pasal Kompilasi Hukum Ekonomi Syariah; menolak jujur bila naskahnya belum diimpor |
| `cari_hadis_berderajat`, `hadis_berderajat`, `daftar_kategori_hadis` | Hadis lengkap dengan derajat kesahihan, takhrij, syarah, dan faedah |
| `cari_produk_dsn` | Pedoman implementasi dan ta'limat DSN-MUI — cara fatwa diterapkan pada produk nyata |
| `cari_turats`, `penulis_turats` | Verifikasi redaksi kaidah fikih ke kitab turats, lengkap dengan kitab, penulis, jilid, dan halaman |
| **`konsolidasi_peraturan`** | Jejak perubahan sebuah pasal lintas undang-undang perubahan, lalu susun rantai sitasi yang benar |
| **`verifikasi_kutipan`** | Periksa seluruh sitasi dalam sebuah draf: keberadaan, status, nomor pasal, dan frasa yang dikutip |
| **`hukum_pada_tanggal`** | Apakah sebuah peraturan berlaku pada tanggal tertentu, berikut garis waktunya |
| **`daftar_periksa_akad`** | Butir ketentuan fatwa DSN-MUI sebagai daftar periksa kepatuhan akad |
| **`periksa_kesehatan_sumber`** | Tembak tiap sumber dengan kueri yang hasilnya sudah diketahui, lalu laporkan sehat, lambat, membatasi, atau berubah struktur |
| `cari_fatwa_dsn` | Cari fatwa DSN-MUI dari indeks lengkap, di-cache 7 hari |
| `teks_fatwa_dsn` | Ambil isi salinan fatwa DSN-MUI sebagai teks |
| `ambil_ayat`, `cari_ayat` | Ayat Al-Quran: Arab, transliterasi, terjemahan Kemenag, asbab nuzul |
| `daftar_kitab_hadis`, `ambil_hadis` | Hadis dari sembilan kitab: Arab dan terjemahan Indonesia |

## Pemasangan

Butuh Node.js 22 ke atas dan `curl` pada PATH (Windows 10 ke atas sudah menyertakannya).

**Claude Code**

```bash
claude mcp add hukum-id --scope user -- npx -y hukum-id-mcp
```

**Claude Desktop** — tambahkan ke `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hukum-id": { "command": "npx", "args": ["-y", "hukum-id-mcp"] }
  }
}
```

**Dari sumber**

```bash
git clone <url-repo> && cd hukum-id-mcp && npm ci && npm run build
claude mcp add hukum-id --scope user -- node "$(pwd)/dist/mcp/stdio.js"
```

Pengujian:

```bash
npm test             # uji fixture, unit, security, API, MCP, storage, dan contract
npm run verify       # lint + OpenAPI + test + typecheck + build API/Web
npm run test:parser  # parser saja, tanpa satu pun permintaan jaringan
npm run test:abstain # exact lookup palsu wajib abstain, tanpa jaringan
npm run test:load    # 3 × 50 request fixture, p95 dan egress gate
npm run test:web-vitals # LCP/INP Edge headless pada profil ponsel
npm run smoke        # canary end-to-end; menyentuh sumber live
```

`test/parser.test.js` menjalankan seluruh parser terhadap salinan HTML nyata di
`test/fixtures/`. Ini penting karena risiko terbesar proyek ini bukan salah logika,
melainkan situs sumber yang berganti tampilan — ketika itu terjadi, parser rusak diam-diam:
tool tetap menjawab, tetapi isinya kosong. Uji fixture menangkapnya sebelum pengguna
terdampak, dan sudah terbukti: ia menemukan bug pagination yang membuat jumlah halaman hasil
pencarian terbaca 1 padahal 3.560.

Untuk memeriksa apakah situs sumbernya sendiri yang berubah, jalankan tool
`periksa_kesehatan_sumber`. Status `berubah_struktur` berarti permintaan berhasil tetapi
hasilnya tidak sesuai bentuk yang diharapkan — itu sinyal parser perlu diperbarui.

### Integrasi berkelanjutan

Workflow `ci.yml` menjalankan verifikasi deterministik, audit dependency, kompilasi Bicep, dan
Docker build pada push/PR. `uji.yml` hanya menembak sumber resmi seminggu sekali atau secara
manual. `deploy.yml` membuat revision canary, `promote.yml` mempromosikannya setelah metrik
ditinjau, dan `rollback.yml` mengembalikan trafik ke revision sehat yang dipilih operator.

Alasannya bukan teknis melainkan etis: menjalankan uji terhadap server yang dibiayai
anggaran publik pada setiap push berarti membebani mereka demi kenyamanan kita. Sekali
seminggu sudah cukup untuk mendeteksi situs yang berganti tampilan.

## Kontribusi

Lihat [CONTRIBUTING.md](CONTRIBUTING.md). Ringkasnya: setiap tool wajib mengembalikan
sumbernya, kegagalan tidak boleh menyamar sebagai temuan negatif, parser harus dapat diuji
tanpa jaringan, dan penambahan yang menaikkan beban situs sumber tidak akan diterima.

### Snapshot korpus inti

Agar peneliti baru tidak perlu menembak situs pemerintah untuk dokumen yang hampir selalu
dibutuhkan, isi cache sekali lalu bagikan berkasnya:

```bash
npm run snapshot            # korpus inti lengkap dengan PDF
npm run snapshot:ringkas    # metadata saja, jauh lebih kecil
```

Hasilnya ada di cache pengguna (`~/.cache/hukum-id-mcp`, atau `HUKUM_CACHE_DIR`). Kemas folder
itu menjadi satu arsip dan bagikan; penerima cukup membongkarnya ke lokasi yang sama. Korpus inti mencakup undang-undang pokok ekonomi syariah,
KUHP dan KUHAP beserta transisinya, UU pembentukan peraturan perundang-undangan berikut
seluruh perubahannya, produk hukum Mahkamah Agung, indeks seluruh fatwa DSN-MUI, dan indeks
hadis kategori fikih.

## Etika Pemakaian

Perangkat ini mengambil dokumen dari situs lembaga negara yang dibiayai anggaran publik.
Satu peneliti yang mengambil dokumen sesekali bukan masalah; seribu peneliti yang
masing-masing mengambil dokumen yang sama berulang-ulang adalah masalah.

Yang dilakukan perangkat ini:

- Mengambil atas permintaan pengguna, satu permintaan pada satu waktu, dengan jeda sopan
  per host dan pemutus arus bila sumber menolak.
- Menyimpan hasilnya agar dokumen yang sama tidak diambil berulang kali.
- Mengikuti sinyal `robots.txt`. JDIH BPK dan Direktori Putusan MA memberi `Allow: /` dengan
  `Content-Signal: search=yes, ai-train=no, use=reference` — pemakaian di sini adalah
  rujukan atas permintaan pengguna, bukan pelatihan model.

Yang tidak dilakukan dan tidak boleh ditambahkan:

- Penjelajahan massal atau pengunduhan seluruh basis data.
- Pengumpulan untuk melatih model.
- Melewati CAPTCHA atau pembatasan akses lainnya.

Bila memakainya dalam skala besar, pakai snapshot bersama, dan pertimbangkan menghubungi
lembaga sumber untuk meminta akses resmi.

**Perangkat ini bukan nasihat hukum dan bukan fatwa.** Penetapan hukum syariah adalah
kewenangan lembaga fatwa dan Dewan Pengawas Syariah; penyelesaian sengketa adalah kewenangan
pengadilan.

## Kinerja

Tiga lapisan membuat pemakaian berulang nyaris seketika:

- **Cache berkas di disk** (`HUKUM_CACHE_DIR` atau cache pengguna). Dokumen hukum resmi yang sudah diundangkan tidak
  berubah, jadi PDF dan salinan putusan disimpan 60 hari, halaman metadata 7 hari, dan
  hasil pencarian 1 hari.
- **Cache teks hasil ekstraksi PDF.** Membedah PDF adalah bagian termahal; sekali dibedah,
  penyaringan halaman dan kata kunci berjalan di atas hasil simpanan.
- **Kerja paralel dan anggaran waktu.** Bagian yang tidak saling bergantung dijalankan
  bersamaan, dan pengayaan opsional seperti silang-periksa MK diberi batas waktu ketat
  supaya sumber yang sedang lambat tidak menahan seluruh jawaban.

Pengukuran yang dapat direproduksi tersedia di
[docs/performance-evidence.md](docs/performance-evidence.md). Ringkasan kandidat 0.7.0:

| Gate lokal | Hasil |
|---|---:|
| Search, 3 × 50 request | median p95 65,57 ms |
| Exact lookup REST, 3 × 50 request | median p95 58,77 ms |
| Web mobile-medium, 3 browser | LCP terburuk 2.192 ms; INP terburuk 144 ms |

Angka ini memakai fixture dan mengukur overhead platform lokal. Cold start Container Apps,
Azure Storage, connector live, dan Real User Monitoring tetap wajib diukur di staging/produksi.

Ada pula **pemutus arus**: bila sebuah host menolak dua permintaan beruntun, host itu
dilewati cepat selama satu menit dengan pesan yang jelas, alih-alih menahan alur lain
dengan retry berulang. Data dari cache tetap dilayani selama pemutus aktif.

## Catatan Teknis

- **Transport ganda.** Sebagian situs sumber berada di belakang Cloudflare dan menolak
  sidik jari TLS milik `fetch` bawaan Node, tetapi menerima `curl`. Karena itu `src/http.js`
  memakai `fetch` lebih dulu lalu jatuh ke `curl` sebagai cadangan, dan langsung memakai
  `curl` untuk host yang sudah diketahui rewel. `curl` harus tersedia di PATH
  (Windows 10 ke atas sudah menyertakannya).
- **Jeda sopan.** Ada jeda minimum per host (900 ms umum, 2.600 ms untuk Direktori Putusan
  MA) plus retry dengan backoff. Server ini dirancang untuk pencarian atas permintaan
  pengguna, bukan untuk penjelajahan massal.
- **robots.txt.** JDIH BPK dan Direktori Putusan MA memberi sinyal
  `Content-Signal: search=yes, ai-train=no, use=reference` dengan `Allow: /` untuk agen
  umum, dan melarang crawler pelatihan model. Pemakaian di sini adalah pencarian rujukan
  atas permintaan pengguna, satu permintaan pada satu waktu, tanpa pengumpulan massal dan
  tanpa pelatihan model. Jangan ubah server ini menjadi crawler.
- **Pencarian teks-bebas MA dilindungi CAPTCHA.** Karena itu penelusuran MA dilakukan lewat
  indeks direktori. Untuk pencarian kata kunci, gunakan mesin pencari dengan
  `site:putusan3.mahkamahagung.go.id`, lalu verifikasi hasilnya dengan `detail_putusan_ma`.
- **Kualitas teks PDF.** Sebagian PDF resmi memiliki lapisan teks yang cacat. Bila kutipan
  terlihat rusak, bandingkan langsung dengan PDF sumbernya sebelum dipakai.
- **Teks Arab pada PDF fatwa DSN keluar rusak** karena memakai font non-Unicode. Terjemahan
  Indonesianya utuh. Ambil teks Arab dalil lewat `ambil_ayat` atau `ambil_hadis`, jangan
  dari hasil ekstraksi PDF fatwa.
- **Indeks fatwa DSN** dibangun sekali (sekitar 25 detik untuk seluruh halaman) lalu
  disimpan di `.cache/fatwa-dsn.json` dan dipakai ulang selama 7 hari. Paksa perbarui dengan
  argumen `paksa_segarkan`.
- **Naskah KHES tidak beredar dalam bentuk yang dapat diambil mesin.** PDF PERMA 2/2008 di
  JDIH MA hanya memuat batang tubuh PERMA dua halaman; perpustakaan BLDK Mahkamah Agung tidak
  dapat dijangkau dan JDIH Kemenkeu hanya menyajikan halaman aplikasi. Karena itu
  `impor_khes` disediakan: muat salinan Anda sendiri sekali, lalu `cari_pasal_khes` bekerja
  penuh. Naskahnya tidak ikut disebarkan bersama perangkat ini — haknya ada pada Mahkamah
  Agung. Struktur bukunya sudah diverifikasi ke naskah primer Edisi Revisi 2011: Buku I
  Pasal 1-19, Buku II 20-667, Buku III 668-727, Buku IV 728-790.
- **POJK, SEOJK, dan PBI ternyata sudah terindeks di JDIH BPK** lengkap dengan statusnya,
  sehingga tidak diperlukan modul khusus untuk situs OJK. Pakai kode `jenis`: 80 untuk POJK,
  78 untuk PBI, 79 untuk Surat Edaran Bank Indonesia.

## Skill Pendamping

Dipasang di `~/.claude/skills/`.

Hukum umum: `hukum-riset-id` (jangkar), `penalaran-hukum-id`, `legal-opinion-id`,
`legal-drafting-id`, `sitasi-hukum-id`.

Hukum ekonomi syariah: `hukum-ekonomi-syariah-id` (jangkar dua perspektif), `ushul-fiqh`,
`qawaid-fiqhiyyah`.

## Lisensi

Kode: MIT — lihat [LICENSE](LICENSE).

Isi dokumen hukum yang diambil melalui perangkat ini tetap milik dan tanggung jawab lembaga
penerbitnya, bukan milik proyek ini. Batasnya dijelaskan di [NOTICE.md](NOTICE.md).

---

## English

**hukum-id-mcp** is an MCP server for Indonesian legal research, with a focus on Islamic
economic law (*hukum ekonomi syariah*). It connects an AI assistant to primary sources so
that legal claims rest on retrieved documents rather than recalled ones — Indonesian law
changes quickly, and answers from memory routinely cite repealed regimes.

**Sources.** JDIH BPK (statutes, in-force status, amendment relations, official PDFs),
Supreme Court decision directory, Constitutional Court decisions, Supreme Court JDIH
(PERMA/SEMA/KMA), DSN-MUI fatwas, Quran, hadith with authenticity grading, classical Islamic
legal texts, and OpenAlex for scholarship.

**What makes it more than a search tool.** It checks whether a statute is still in force,
traces how a specific article changed across amending statutes and produces the correct
citation chain, verifies every citation in a draft, determines whether a rule was in force on
a given date, and turns fatwa provisions into a compliance checklist. Every output carries
explicit warnings where the underlying source is incomplete or unreliable.

**Install**

```bash
claude mcp add hukum-id --scope user -- npx -y hukum-id-mcp
```

**Please read the Etika Pemakaian (Ethics of Use) section above before deploying this at
scale.** The tool retrieves from public-funded government sites one request at a time; a
shared cache snapshot exists precisely so that many researchers do not each hammer the same
endpoints. Bulk crawling and model-training collection are out of scope by design.

This tool is not legal advice and not a fatwa.
