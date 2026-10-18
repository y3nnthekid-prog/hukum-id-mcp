# Azure terkelola pada preview privat

18 Oktober 2026. Mengubah batas BYOK pada ADR 003 hanya untuk akun preview yang diundang.

Browser mengirim laporan tersimpan ke Pages Functions pada origin preview. Functions memeriksa sesi, origin, pemilik, versi sumber daya, attempt dan hash masukan; reservasi D1 atomik mendahului tiket v2 dan pengiriman ke mesin. Tiket tidak dikembalikan ke browser. BYOK memakai tiket v1 dan batas lama tanpa fallback.

Kunci resource Azure PASLA hanya berada pada environment rahasia layanan VPS preview. Transport mematok endpoint, deployment pasla-chat, gpt-5-mini-2025-08-07, reasoning low dan max_completion_tokens 4096. Full wire bytes + 1024 diperiksa terhadap batas input tiket sebelum network. Skema Azure menghilangkan keyword yang tidak didukung sambil mempertahankan petunjuk batas; Zod lokal tetap wajib.

Konsumsi jti dan gerbang satu permintaan/65 detik disimpan SQLite operasional terpisah dari korpus, bertahan restart. Tidak ada pertanyaan, isi laporan, akun atau key pada SQLite itu. D1 menyimpan metadata reservasi dan token terukur; total kampanye bertahan penghapusan akun dan deploy. Seed 58.508 microUSD dari pilot sebelumnya, total maksimum 1.000.000 microUSD, paling banyak 36 reservasi tambahan. Kegagalan/ketidakpastian tidak direfund. Ini pengaman aplikasi, bukan plafon Azure.

Rilis awal memakai dua flag nonaktif. Rollback: nonaktifkan AI_MANAGED_ENABLED pada Pages preview dan PASLA_MANAGED_AI_ENABLED pada VPS, lalu kembalikan path service preview ke rilis sebelumnya. Pertahankan ledger D1 dan SQLite replay; jangan reset anggaran. Produksi v1 dan branch main tidak diubah.
