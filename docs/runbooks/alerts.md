# Runbook alert HukumID

## Error rate API atau latency p95

Kelompokkan hanya menurut `http.route`, method, dan status class. Jangan membuka query string
atau body. Bandingkan revision canary dengan revision stabil. Bila error rate >=1% atau target
p95 terlewati selama 10 menit, arahkan trafik kembali ke revision sehat dan simpan trace ID
contoh yang sudah direduksi.

Target pilot: warm search p95 <=500 ms; exact lookup p95 <=300 ms; overhead platform job AI
p95 <=1 detik di luar waktu provider.

## Source degraded/unavailable

Periksa `/v1/sources/status` dan canary mingguan. Jangan menafsirkan hasil kosong sebagai
ketiadaan hukum. Pertahankan snapshot sehat terakhir, tandai source sebagai incomplete, dan
jangan mempublikasikan release indeks bila satu connector wajib gagal.

## Tingkat abstain atau unsupported claims naik

Lonjakan abstain dapat berarti sumber gagal, parser berubah, atau evidence resolver menolak
hash. Jalankan fixture test terlebih dahulu. Jangan menurunkan validator AI atau mengubah
status evidence hanya agar jawaban kembali muncul.

## Antrean atau upload deletion tertahan

Periksa status Container Apps Job, Queue depth, Table metadata kedaluwarsa, lalu Blob. Jalankan
sweeper manual hanya dengan identitas worker. Insiden privasi dibuka bila blob/wrapped key
masih dapat digunakan >25 jam setelah dibuat. Jangan mencatat nama file, pemilik, atau isi.

## 429 dan biaya

429 dipisahkan antara platform dan provider. Jangan merotasi API key untuk melewati kuota
Gemini karena kuota berada pada project. Budget Azure harus memberi notifikasi actual spend
pada 50%, 75%, dan 90%.
