import { AiProviderError, safeProviderMessage, type AiProviderId, type JsonModel } from "./json-model.js";

/**
 * Alamat penyedia yang dikenal. Sengaja tidak menerima alamat kustom dari
 * pengguna: alamat bebas akan menjadikan server ini proksi POST ke host mana
 * pun yang dipilih pengunjung.
 */
export const OPENAI_COMPATIBLE_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
} as const satisfies Partial<Record<AiProviderId, string>>;

export type OpenAiCompatibleProvider = keyof typeof OPENAI_COMPATIBLE_BASE_URLS;

export function isOpenAiCompatible(provider: AiProviderId): provider is OpenAiCompatibleProvider {
  return provider in OPENAI_COMPATIBLE_BASE_URLS;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Model berkeluaran JSON lewat endpoint chat/completions yang kompatibel
 * OpenAI. Nama model wajib diisi pengguna: daftar model penyedia ini berubah
 * cepat, dan menebak nama model lebih buruk daripada memintanya.
 */
export function createOpenAiCompatibleJsonModel(input: {
  provider: OpenAiCompatibleProvider;
  apiKey: string;
  model: string;
  timeoutMs?: number | undefined;
  fetchImpl?: FetchLike | undefined;
}): JsonModel {
  if (!input.apiKey.trim()) throw new Error("Kunci API penyedia wajib diisi.");
  if (!input.model.trim()) throw new Error("Nama model wajib diisi untuk penyedia ini.");
  const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[input.provider];
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 60_000, 5_000), 120_000);
  const doFetch: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));

  return {
    provider: input.provider,
    model: input.model,
    async generate({ system, user, schema, signal }) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          redirect: "error",
          signal: combined,
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            temperature: 0.1,
            max_tokens: 4_096,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
      } catch {
        throw new AiProviderError(safeProviderMessage(input.provider, undefined));
      }
      if (!response.ok) {
        // Body galat penyedia tidak dibaca agar tidak ada isi yang terpantul ke pengguna.
        await response.body?.cancel().catch(() => undefined);
        throw new AiProviderError(safeProviderMessage(input.provider, response.status));
      }
      try {
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
        };
        const choice = payload.choices?.[0];
        if (choice?.finish_reason === "length") throw new AiProviderError("Jawaban penyedia terpotong sebelum selesai.");
        const content = choice?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new AiProviderError("Penyedia tidak mengembalikan jawaban.");
        return schema.parse(JSON.parse(content));
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError("Penyedia mengembalikan JSON yang tidak sesuai bentuk yang diminta.");
      }
    },
  };
}
