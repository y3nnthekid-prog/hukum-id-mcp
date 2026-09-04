#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";

import { createGeminiEvidenceProvider } from "../ai/gemini.js";
import { createEntraAuthenticatorFromEnvironment } from "../auth.js";
import { createLegalResearchService } from "../core/service.js";
import { legacyAdapters } from "../core/legacy-adapters.js";
import { createPlatformServer } from "../platform.js";
import { createAzureSecureUploadService } from "../storage/azure.js";
import { createAzureCorpusEvidenceResolver } from "../storage/evidence.js";

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT harus berupa angka 1-65535.");

const allowedOrigins = (process.env.HUKUM_ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const expectedToken = process.env.HUKUM_MCP_BEARER_TOKEN;
const authenticate = createEntraAuthenticatorFromEnvironment();
if (process.env.NODE_ENV === "production" && !authenticate) {
  throw new Error("Entra authentication wajib di production; isi ENTRA_TENANT_ID dan ENTRA_CLIENT_ID.");
}
const uploadService = process.env.AZURE_STORAGE_ACCOUNT_NAME ? await createAzureSecureUploadService() : undefined;
const evidenceResolver = process.env.AZURE_STORAGE_ACCOUNT_NAME
  ? createAzureCorpusEvidenceResolver(process.env.AZURE_STORAGE_ACCOUNT_NAME)
  : undefined;
const platformGeminiKey = process.env.GEMINI_API_KEY?.trim();

const service = createLegalResearchService(legacyAdapters);
const server = createPlatformServer({
  service,
  allowedOrigins,
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

server.listen(port, "0.0.0.0", () => {
  console.error(`HukumID API + MCP listening on :${port}`);
  if (!authenticate && !expectedToken) {
    console.error("WARNING: remote MCP authentication is disabled for local development.");
  }
  if (!uploadService) console.error("INFO: Azure upload storage is disabled until AZURE_STORAGE_ACCOUNT_NAME is set.");
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
