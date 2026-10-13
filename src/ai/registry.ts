import { createClaudeJsonModel } from "./claude.js";
import { createGeminiJsonModel } from "./gemini.js";
import type { AiProviderId, JsonModel } from "./json-model.js";
import { createOpenAiCompatibleJsonModel, isOpenAiCompatible } from "./openai-compatible.js";

export type AiSelection = {
  provider: AiProviderId;
  apiKey: string;
  model?: string | undefined;
};

/** Membuat JsonModel dari pilihan pengguna atau konfigurasi platform. */
export function createJsonModel(selection: AiSelection): JsonModel {
  if (selection.provider === "claude") {
    return createClaudeJsonModel({ apiKey: selection.apiKey, model: selection.model });
  }
  if (selection.provider === "gemini") {
    return createGeminiJsonModel({ apiKey: selection.apiKey, model: selection.model, timeoutMs: 60_000 });
  }
  if (isOpenAiCompatible(selection.provider)) {
    if (!selection.model?.trim()) throw new Error("MODEL_REQUIRED");
    return createOpenAiCompatibleJsonModel({
      provider: selection.provider,
      apiKey: selection.apiKey,
      model: selection.model,
    });
  }
  throw new Error("PROVIDER_UNSUPPORTED");
}
