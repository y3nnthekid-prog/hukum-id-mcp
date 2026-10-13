import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createApiApp, type AiModelSelection, type JobStore, type ResolvedAiModel, type UploadStore } from "./api/app.js";
import type { AskFunction } from "./core/ask.js";
import type { EvidenceSynthesisProvider } from "./ai/evidence-synthesis.js";
import type { Evidence } from "./core/contracts.js";
import type { LegalResearchService } from "./core/service.js";
import { createEvidenceFirstMcpServer } from "./mcp/server.js";

type PlatformOptions = {
  service: LegalResearchService;
  uploadStore?: UploadStore;
  jobStore?: JobStore;
  allowedOrigins?: string[];
  authenticate?: (authorization: string | undefined) => Promise<string | null>;
  authorizeMcp?: (request: IncomingMessage) => boolean | Promise<boolean>;
  makeAiProvider?: (ephemeralApiKey: string | undefined) => EvidenceSynthesisProvider | null;
  resolveEvidence?: (evidenceIds: string[], ownerId: string) => Promise<Evidence[]>;
  ask?: AskFunction;
  resolveAiModel?: (selection: AiModelSelection) => ResolvedAiModel;
  platformAiDailyLimit?: number;
  askConcurrency?: { active: number; queued: number };
  trustCloudflareIp?: boolean;
  /** Matikan endpoint MCP remote sepenuhnya. */
  disableMcp?: boolean;
};

async function jsonBody(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("MCP_PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("MCP_INVALID_JSON");
  }
}

function jsonRpcError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export function createPlatformServer(options: PlatformOptions) {
  const app = createApiApp({
    service: options.service,
    ...(options.uploadStore ? { uploadStore: options.uploadStore } : {}),
    ...(options.jobStore ? { jobStore: options.jobStore } : {}),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.authenticate ? { authenticate: options.authenticate } : {}),
    ...(options.makeAiProvider ? { makeAiProvider: options.makeAiProvider } : {}),
    ...(options.resolveEvidence ? { resolveEvidence: options.resolveEvidence } : {}),
    ...(options.ask ? { ask: options.ask } : {}),
    ...(options.resolveAiModel ? { resolveAiModel: options.resolveAiModel } : {}),
    ...(options.platformAiDailyLimit !== undefined ? { platformAiDailyLimit: options.platformAiDailyLimit } : {}),
    ...(options.askConcurrency ? { askConcurrency: options.askConcurrency } : {}),
    ...(options.trustCloudflareIp ? { trustCloudflareIp: true } : {}),
  });
  const apiListener = getRequestListener(app.fetch);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== "/mcp") {
      return apiListener(request, response);
    }
    if (options.disableMcp) {
      return jsonRpcError(response, 404, "MCP remote tidak dibuka pada server ini.");
    }

    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("cache-control", "no-store");
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return jsonRpcError(response, 403, "Origin tidak diizinkan.");
    }
    if (options.authorizeMcp && !(await options.authorizeMcp(request))) {
      response.setHeader("www-authenticate", "Bearer");
      return jsonRpcError(response, 401, "Autentikasi MCP diperlukan.");
    }
    if (request.method !== "POST") {
      return jsonRpcError(response, 405, "Stateless MCP hanya menerima POST.");
    }

    let transport: StreamableHTTPServerTransport | undefined;
    let mcp: ReturnType<typeof createEvidenceFirstMcpServer> | undefined;
    try {
      const body = await jsonBody(request);
      mcp = createEvidenceFirstMcpServer(options.service);
      // SDK menandai stateless dengan nilai undefined, tetapi deklarasi tipenya
      // belum kompatibel dengan exactOptionalPropertyTypes.
      const stateless = { sessionIdGenerator: undefined } as unknown as StreamableHTTPServerTransportOptions;
      transport = new StreamableHTTPServerTransport(stateless);
      await mcp.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        const message = error instanceof Error && error.message === "MCP_PAYLOAD_TOO_LARGE"
          ? "Payload MCP terlalu besar."
          : "Permintaan MCP tidak dapat diproses.";
        jsonRpcError(response, error instanceof Error && error.message === "MCP_PAYLOAD_TOO_LARGE" ? 413 : 400, message);
      }
    } finally {
      await transport?.close().catch(() => undefined);
      await mcp?.close().catch(() => undefined);
    }
  });
}
