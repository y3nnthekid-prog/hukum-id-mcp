# Deployment Azure

## Prasyarat

- Node.js 24 dan Azure CLI dengan Bicep.
- Resource group deployment dan Storage Account yang sudah ada.
- Federated identity GitHub Actions dengan izin membuat resource/role assignment yang dibutuhkan.
- Entra tenant/client untuk verifikasi bearer token.
- Static Web Apps deployment token.

Tidak ada Storage connection string yang diperlukan. Isi konfigurasi pada GitHub Environment:

- Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
  `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- Variables: `AZURE_RESOURCE_GROUP`, `HUKUM_PREFIX`, `AZURE_STORAGE_ACCOUNT_NAME`,
  `AZURE_STORAGE_RESOURCE_GROUP`, `HUKUM_API_URL`.

## Provisioning

Validasi lokal tanpa membuat resource:

```powershell
az bicep build --file infra/main.bicep --stdout > $null
az bicep build-params --file infra/main.example.bicepparam --stdout > $null
```

Deployment dilakukan lewat workflow `Deploy Azure canary`. Workflow membuat shared infra
lebih dulu, mendorong image ber-tag Git SHA, membuat revision, menguji `/health` pada label
canary, lalu mengalihkan 5%, 10%, atau 25% trafik. Setelah metrik canary sehat, jalankan
workflow `Promote Azure API revision` dengan nama revision persis untuk memindahkan 100% trafik.

Jika platform Gemini key dipakai, berikan parameter secure `geminiApiKey` hanya saat
deployment Bicep. Untuk pilot BYOK-only, biarkan kosong.

## Rollback

Jalankan workflow `Roll back Azure API revision`, pilih environment, dan masukkan nama revision
sehat yang persis. Workflow memeriksa health state sebelum mengalihkan 100% trafik. Release
indeks dipulihkan terpisah dengan mengembalikan `index-releases/active.json` melalui proses
compare-and-swap terotorisasi; jangan menimpa file release immutable.

## Retensi

Job `upload-sweeper` berjalan pada menit ke-15 setiap jam. Alarm wajib aktif bila umur upload
melewati 25 jam, job gagal dua kali, atau wrapped key masih ada setelah metadata kedaluwarsa.
