import { GoogleGenAI } from "@google/genai";

import { type EvidenceSynthesisProvider } from "./evidence-synthesis.js";
import {
  AiProviderError,
  evidenceProviderFromModel,
  jsonSchemaOf,
  safeProviderMessage,
  type JsonModel,
} from "./json-model.js";

export { AiProviderError } from "./json-model.js";

/**
 * Model Gemini berkeluaran JSON terstruktur.
 * Sumber: https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html
 */
export function createGeminiJsonModel(input: {
  apiKey: string;
  model?: string | undefined;
  timeoutMs?: number | undefined;
}): JsonModel {
  if (!input.apiKey.trim()) throw new Error("Gemini API key wajib tersedia di server atau dikirim melalui BYOK.");
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const model = input.model?.trim() || "gemini-2.5-flash";
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 1_000), 90_000);

  return {
    provider: "gemini",
    model,
    async generate({ system, user, schema, signal }) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      try {
        const response = await client.models.generateContent({
          model,
          contents: user,
          config: {
            abortSignal: combined,
            systemInstruction: system,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchemaOf(schema),
            temperature: 0.1,
            maxOutputTokens: 4_096,
          },
        });
        if (!response.text) throw new AiProviderError("Gemini tidak mengembalikan jawaban.");
        return schema.parse(JSON.parse(response.text));
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        const status = (error as { status?: unknown }).status;
        throw new AiProviderError(safeProviderMessage("gemini", typeof status === "number" ? status : undefined));
      }
    },
  };
}

/** Dipertahankan untuk pemanggil lama; kini dibangun di atas JsonModel. */
export function createGeminiEvidenceProvider(input: {
  apiKey: string;
  model?: string | undefined;
  timeoutMs?: number | undefined;
}): EvidenceSynthesisProvider {
  return evidenceProviderFromModel(createGeminiJsonModel(input));
}
