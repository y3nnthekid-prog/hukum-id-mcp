#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";

import { createLegalResearchService } from "../core/service.js";
import { legacyAdapters } from "../core/legacy-adapters.js";
import { createPlatformServer } from "../platform.js";

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT harus berupa angka 1-65535.");

const allowedOrigins = (process.env.HUKUM_ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const expectedToken = process.env.HUKUM_MCP_BEARER_TOKEN;

const service = createLegalResearchService(legacyAdapters);
const server = createPlatformServer({
  service,
  allowedOrigins,
  ...(expectedToken
    ? {
        authorizeMcp: (request) => {
          const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
          const left = Buffer.from(supplied);
          const right = Buffer.from(expectedToken);
          return left.length === right.length && timingSafeEqual(left, right);
        },
      }
    : {}),
});

server.listen(port, "0.0.0.0", () => {
  console.error(`HukumID API + MCP listening on :${port}`);
  if (!expectedToken) console.error("WARNING: remote MCP authentication is disabled; set HUKUM_MCP_BEARER_TOKEN.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
