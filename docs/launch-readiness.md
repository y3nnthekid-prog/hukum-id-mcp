# Quality gates menuju production-ready

Label production-ready dilarang sebelum semua gate berikut memiliki bukti:

- [ ] 300 query golden-set ditinjau ahli hukum nasional dan ahli HES.
- [x] Exact lookup 100% abstain pada 51 rujukan fixture tak ada; nol kandidat salah.
- [x] Klaim AI tanpa dukungan tekstual dibuang dan hasilnya abstain.
- [ ] Recall top-5 >=95%; locator pasal/ayat/halaman >=99%.
- [x] Fixture PDF scan, dua kolom, halaman kosong, teks Arab, dan tanggal mustahil lulus.
- [ ] SSRF IPv4/IPv6, DNS rebinding, redirect, PDF bomb, traversal, token leakage, prompt
  injection, dan horizontal access control lulus.
- [x] Contract test Web/API/local MCP/remote MCP lulus untuk corpus release yang sama.
- [x] 50 pengguna serentak: error 0%; median p95 search 65,57 ms dan exact 58,77 ms.
- [x] Web: tiga run LCP terburuk 2.192 ms dan INP terburuk 144 ms pada profil seluler menengah.
- [ ] Upload, hasil turunan, cache, dan key tidak dapat digunakan setelah 24 jam + toleransi 1 jam.
- [ ] Canary dan rollback revision serta rollback index diuji di staging.
- [ ] Alert latency, error, source freshness, abstain, unsupported claim, 429, biaya, dan deletion aktif.

Gate CI saat ini menjalankan lint, fixture/unit/contract test, TypeScript strict, build API/Web,
audit dependency high severity, Bicep build, dan Docker build. Live connector hanya diuji oleh
canary terjadwal agar CI deterministik dan situs publik tidak dibebani setiap commit.

Bukti perintah, nama uji, angka, dan batas klaim dicatat di
[quality-gate-evidence.md](quality-gate-evidence.md) dan
[performance-evidence.md](performance-evidence.md). Gate keamanan gabungan masih dibiarkan
terbuka: SSRF, redirect, response bomb, traversal, prompt injection, redaction, dan akses
horizontal sudah diuji, tetapi PDF decompression bomb belum memiliki harness terisolasi.
