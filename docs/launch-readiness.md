# Quality gates menuju production-ready

Label production-ready dilarang sebelum semua gate berikut memiliki bukti:

- [ ] 300 query golden-set ditinjau ahli hukum nasional dan ahli HES.
- [ ] Exact lookup 100% abstain untuk rujukan tak ada; nol kandidat salah.
- [ ] Nol kutipan fiktif; setiap proposisi AI membuka evidence yang tepat.
- [ ] Recall top-5 >=95%; locator pasal/ayat/halaman >=99%.
- [ ] Fixture PDF scan, dua kolom, halaman kosong, teks Arab, dan tanggal mustahil lulus.
- [ ] SSRF IPv4/IPv6, DNS rebinding, redirect, PDF bomb, traversal, token leakage, prompt
  injection, dan horizontal access control lulus.
- [ ] Contract test Web/API/local MCP/remote MCP lulus untuk corpus release yang sama.
- [ ] 50 pengguna serentak: error <1%; target p95 API tercapai.
- [ ] Web LCP <=2,5 detik dan INP <=200 ms pada profil seluler menengah.
- [ ] Upload, hasil turunan, cache, dan key tidak dapat digunakan setelah 24 jam + toleransi 1 jam.
- [ ] Canary dan rollback revision serta rollback index diuji di staging.
- [ ] Alert latency, error, source freshness, abstain, unsupported claim, 429, biaya, dan deletion aktif.

Gate CI saat ini menjalankan lint, fixture/unit/contract test, TypeScript strict, build API/Web,
audit dependency high severity, Bicep build, dan Docker build. Live connector hanya diuji oleh
canary terjadwal agar CI deterministik dan situs publik tidak dibebani setiap commit.
