import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { HUKUM_ID_VERSION } from "./version.js";

const tracer = trace.getTracer("hukum-id-api", HUKUM_ID_VERSION);
const meter = metrics.getMeter("hukum-id-api", HUKUM_ID_VERSION);
const requestCount = meter.createCounter("hukum.api.requests", {
  description: "Jumlah permintaan API berdasarkan route stabil dan status class.",
});
const requestDuration = meter.createHistogram("hukum.api.duration", {
  description: "Durasi permintaan API dalam milidetik.",
  unit: "ms",
});

const SAFE_ROUTES: ReadonlyArray<[RegExp, string]> = [
  [/^\/health$/, "/health"],
  [/^\/v1\/search$/, "/v1/search"],
  [/^\/v1\/documents\/[^/]+\/articles\/[^/]+$/, "/v1/documents/:id/articles/:article"],
  [/^\/v1\/documents\/[^/]+\/timeline$/, "/v1/documents/:id/timeline"],
  [/^\/v1\/documents\/[^/]+$/, "/v1/documents/:id"],
  [/^\/v1\/citations\/verify$/, "/v1/citations/verify"],
  [/^\/v1\/research$/, "/v1/research"],
  [/^\/v1\/uploads\/[^/]+\/content$/, "/v1/uploads/:id/content"],
  [/^\/v1\/uploads$/, "/v1/uploads"],
  [/^\/v1\/jobs\/[^/]+$/, "/v1/jobs/:id"],
  [/^\/v1\/sources\/status$/, "/v1/sources/status"],
];

export type ApiTelemetryAttributes = {
  "http.request.method": string;
  "http.route": string;
  "http.response.status_code": number;
  "http.response.status_class": string;
};

/**
 * Mengubah path menjadi label dengan cardinality terbatas. Query string, ID,
 * judul dokumen, dan teks pertanyaan tidak pernah diteruskan ke telemetry.
 */
export function classifyApiRoute(pathname: string): string {
  for (const [pattern, label] of SAFE_ROUTES) {
    if (pattern.test(pathname)) return label;
  }
  return "unmatched";
}

export function createApiTelemetryAttributes(
  method: string,
  pathname: string,
  status: number
): ApiTelemetryAttributes {
  return {
    "http.request.method": method.toUpperCase().slice(0, 12),
    "http.route": classifyApiRoute(pathname),
    "http.response.status_code": status,
    "http.response.status_class": `${Math.floor(status / 100)}xx`,
  };
}

export async function observeApiRequest<T>(
  method: string,
  pathname: string,
  operation: () => Promise<T>,
  getStatus: () => number
): Promise<T> {
  const route = classifyApiRoute(pathname);
  const startedAt = performance.now();
  return tracer.startActiveSpan(`${method.toUpperCase()} ${route}`, async (span) => {
    try {
      const result = await operation();
      const status = getStatus();
      const attributes = createApiTelemetryAttributes(method, pathname, status);
      span.setAttributes(attributes);
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR, message: "server_error" });
      requestCount.add(1, attributes);
      requestDuration.record(performance.now() - startedAt, attributes);
      return result;
    } catch (error) {
      const attributes = createApiTelemetryAttributes(method, pathname, 500);
      span.setAttributes(attributes);
      span.setStatus({ code: SpanStatusCode.ERROR, message: "unhandled_error" });
      // Hanya tipe exception dicatat. Message dapat mengandung input privat.
      span.setAttribute("error.type", error instanceof Error ? error.name.slice(0, 80) : "UnknownError");
      requestCount.add(1, attributes);
      requestDuration.record(performance.now() - startedAt, attributes);
      throw error;
    } finally {
      span.end();
    }
  });
}
