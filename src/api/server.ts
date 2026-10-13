#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";

import { createGeminiEvidenceProvider } from "../ai/gemini.js";
import { AiProviderIdSchema, type AiProviderId } from "../ai/json-model.js";
import { createJsonModel } from "../ai/registry.js";
import type { AiModelSelection, ResolvedAiModel } from "./app.js";
import { createEntraAuthenticatorFromEnvironment } from "../auth.js";
import { createAsk } from "../core/ask.js";
import { createLegalResearchService } from "../core/service.js";
import { legacyAdapters } from "../core/legacy-adapters.js";
import { createPlatformServer } from "../platform.js";
import { createAzureSecureUploadService } from "../storage/azure.js";
import { createAzureCorpusEvidenceResolver } from "../storage/evidence.js";

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT harus berupa angka 1-65535.");

// Mode pilot-vm: satu server di belakang Cloudflare Tunnel, tanpa akun dan
// tanpa unggahan. Bind ke localhost karena satu-satunya jalan masuk yang sah
// adalah tunnel; MCP remote dimatikan kecuali token bearer disetel.
const pilotVm = process.env.HUKUM_MODE === "pilot-vm";
const host = process.env.HOST || (pilotVm ? "127.0.0.1" : "0.0.0.0");

const allowedOrigins = (process.env.HUKUM_ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const expectedToken = process.env.HUKUM_MCP_BEARER_TOKEN;
const authenticate = createEntraAuthenticatorFromEnvironment();
if (process.env.NODE_ENV === "production" && !authenticate && !pilotVm) {
  throw new Error("Entra authentication wajib di production; isi ENTRA_TENANT_ID dan ENTRA_CLIENT_ID.");
}
const uploadService =
  !pilotVm && process.env.AZURE_STORAGE_ACCOUNT_NAME ? await createAzureSecureUploadService() : undefined;
const evidenceResolver =
  !pilotVm && process.env.AZURE_STORAGE_ACCOUNT_NAME
    ? createAzureCorpusEvidenceResolver(process.env.AZURE_STORAGE_ACCOUNT_NAME)
    : undefined;
const platformGeminiKey = process.env.GEMINI_API_KEY?.trim();

// Kunci AI platform untuk kuota gratis harian. Opsional; tanpa ini pengguna
// tetap bisa memakai kunci miliknya sendiri (BYOK).
const platformProviderRaw = process.env.PASLA_PLATFORM_AI_PROVIDER?.trim() || (platformGeminiKey ? "gemini" : "");
const platformProvider = platformProviderRaw ? AiProviderIdSchema.parse(platformProviderRaw) : undefined;
const platformKey = process.env.PASLA_PLATFORM_AI_KEY?.trim() || (platformProvider === "gemini" ? platformGeminiKey : undefined);
const platformModel = process.env.PASLA_PLATFORM_AI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || undefined;
const dailyLimit = Number(process.env.PASLA_PLATFORM_AI_DAILY || 15);

function resolveAiModel(selection: AiModelSelection): ResolvedAiModel {
  if (selection.apiKey) {
    if (!selection.provider) return { error: "PROVIDER_REQUIRED" };
    try {
      return {
        model: createJsonModel({ provider: selection.provider, apiKey: selection.apiKey, model: selection.model }),
        platform: false,
      };
    } catch (error) {
      return { error: error instanceof Error && error.message === "MODEL_REQUIRED" ? "MODEL_REQUIRED" : "PROVIDER_UNSUPPORTED" };
    }
  }
  if (platformProvider && platformKey) {
    return {
      model: createJsonModel({ provider: platformProvider as AiProviderId, apiKey: platformKey, model: platformModel }),
      platform: true,
    };
  }
  return { model: null, platform: false };
}

const service = createLegalResearchService(legacyAdapters);
const ask = createAsk({
  adapters: legacyAdapters,
  service,
  limits: pilotVm
    ? [
        "Putusan Mahkamah Konstitusi, JDIH Mahkamah Agung, dan Direktori Putusan MA belum tersedia di layanan ini: situsnya menolak permintaan dari server. Pasla tidak mengakali pembatasan tersebut.",
      ]
    : [],
});

const server = createPlatformServer({
  service,
  allowedOrigins,
  ask,
  resolveAiModel,
  platformAiDailyLimit: Number.isInteger(dailyLimit) && dailyLimit >= 0 ? dailyLimit : 15,
  ...(pilotVm ? { trustCloudflareIp: true } : {}),
  ...(pilotVm && !expectedToken ? { disableMcp: true } : {}),
  ...(uploadService ? { uploadStore: uploadService, jobStore: uploadService } : {}),
  ...(evidenceResolver
    ? {
        resolveEvidence: evidenceResolver,
        makeAiProvider: (ephemeralApiKey: string | undefined) => {
          const apiKey = ephemeralApiKey || platformGeminiKey;
          return apiKey
            ? createGeminiEvidenceProvider({
                apiKey,
                model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
              })
            : null;
        },
      }
    : {}),
  ...(authenticate ? { authenticate } : {}),
  ...(authenticate || expectedToken
    ? {
        authorizeMcp: async (request) => {
          if (authenticate) return Boolean(await authenticate(request.headers.authorization));
          const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
          const left = Buffer.from(supplied);
          const right = Buffer.from(expectedToken!);
          return left.length === right.length && timingSafeEqual(left, right);
        },
      }
    : {}),
});

server.listen(port, host, () => {
  console.error(`HukumID API + MCP listening on ${host}:${port}${pilotVm ? " (mode pilot-vm)" : ""}`);
  if (pilotVm && !expectedToken) console.error("INFO: remote MCP disabled in pilot-vm mode (no bearer token).");
  else if (!authenticate && !expectedToken) {
    console.error("WARNING: remote MCP authentication is disabled for local development.");
  }
  if (!uploadService) console.error("INFO: upload storage is disabled.");
  console.error(
    platformProvider && platformKey
      ? `INFO: platform AI = ${platformProvider}${platformModel ? ` (${platformModel})` : ""}, ${dailyLimit}/hari per klien.`
      : "INFO: platform AI tidak dikonfigurasi; hanya BYOK."
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
        const { shutdownAzureMonitor } = await import("@azure/monitor-opentelemetry");
        await shutdownAzureMonitor().catch(() => undefined);
      }
      process.exit(0);
    });
  });
}
