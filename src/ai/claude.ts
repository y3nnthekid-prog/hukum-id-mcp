import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { AiProviderError, safeProviderMessage, type JsonModel } from "./json-model.js";

/** Bawaan bila pengguna tidak memilih model. Pengguna BYOK bebas memilih model lain. */
export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";

// Model yang menerima parameter effort. Model lama (mis. Haiku 4.5) menolaknya.
const SUPPORTS_EFFORT = /^claude-(opus-(5-5|5|4-[678])|sonnet-(5-5|5|4-6)|haiku-5-5|fable-5(-1)?)$/;
// Model yang menerima fallback server-side bentuk "default". Haiku 5.5 tidak punya fallback.
const SUPPORTS_FALLBACK = /^claude-(opus-(5-5|5)|sonnet-5-5|fable-5-1)$/;

/**
 * Model Claude berkeluaran JSON terstruktur lewat output_config.format.
 * Kunci dipakai per permintaan dan tidak disimpan di mana pun.
 */
export function createClaudeJsonModel(input: {
  apiKey: string;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  /** Hanya untuk uji lokal; tidak pernah diisi dari permintaan pengguna. */
  baseURL?: string | undefined;
}): JsonModel {
  if (!input.apiKey.trim()) throw new Error("Kunci API Claude wajib tersedia di server atau dikirim melalui BYOK.");
  const model = input.model?.trim() || CLAUDE_DEFAULT_MODEL;
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 90_000, 5_000), 120_000);
  const client = new Anthropic({
    apiKey: input.apiKey,
    maxRetries: 1,
    timeout: timeoutMs,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  });

  return {
    provider: "claude",
    model,
    async generate({ system, user, schema, effort, signal }) {
      try {
        const response = await client.beta.messages.parse(
          {
            model,
            max_tokens: 16_000,
            system,
            messages: [{ role: "user", content: user }],
            output_config: {
              format: betaZodOutputFormat(schema as never),
              ...(SUPPORTS_EFFORT.test(model) ? { effort } : {}),
            },
            ...(SUPPORTS_FALLBACK.test(model)
              ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
              : {}),
          },
          { ...(signal ? { signal } : {}) }
        );
        if (response.stop_reason === "refusal") {
          throw new AiProviderError("Claude menolak menjawab permintaan ini.");
        }
        if (response.stop_reason === "max_tokens") {
          throw new AiProviderError("Jawaban Claude terpotong sebelum selesai.");
        }
        if (response.parsed_output === null || response.parsed_output === undefined) {
          throw new AiProviderError("Claude tidak mengembalikan JSON yang sah.");
        }
        return schema.parse(response.parsed_output);
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        const status = error instanceof Anthropic.APIError ? error.status : undefined;
        throw new AiProviderError(safeProviderMessage("claude", typeof status === "number" ? status : undefined));
      }
    },
  };
}
