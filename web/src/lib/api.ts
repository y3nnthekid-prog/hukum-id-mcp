import type { SearchResponse, SearchSource } from "./types";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly traceId?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type SearchInput = { query: string; sources?: SearchSource[]; pageSize?: number };
type ClientOptions = { baseUrl?: string; fetch?: typeof fetch };

export async function searchLegalSources(input: SearchInput, options: ClientOptions = {}): Promise<SearchResponse> {
  const baseUrl = (options.baseUrl ?? process.env.NEXT_PUBLIC_HUKUM_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  const query = new URLSearchParams({ q: input.query });
  if (input.sources?.length) query.set("sources", input.sources.join(","));
  if (input.pageSize) query.set("pageSize", String(input.pageSize));

  const response = await fetcher(`${baseUrl}/v1/search?${query.toString()}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json()) as SearchResponse | {
    error?: { code?: string; message?: string; traceId?: string };
  };
  if (!response.ok) {
    const error = "error" in body ? body.error : undefined;
    throw new ApiClientError(error?.message ?? "Pencarian gagal diproses.", error?.code ?? "API_ERROR", error?.traceId);
  }
  return body as SearchResponse;
}
