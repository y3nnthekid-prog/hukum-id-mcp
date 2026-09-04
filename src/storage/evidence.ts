import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

import { createEvidence, EvidenceSchema, type Evidence } from "../core/contracts.js";

export interface EvidenceObjectStore {
  get(id: string): Promise<unknown | null>;
}

function hasValidIdentity(evidence: Evidence) {
  const { contentHash: _contentHash, ...provenance } = evidence.provenance;
  const recreated = createEvidence({
    documentId: evidence.documentId,
    text: evidence.text,
    locator: evidence.locator,
    provenance,
  });
  return recreated.id === evidence.id && recreated.provenance.contentHash === evidence.provenance.contentHash;
}

/** Resolve only server-owned evidence objects; malformed or tampered blobs fail closed. */
export function createEvidenceResolver(store: EvidenceObjectStore, options: { maxItems?: number } = {}) {
  const maxItems = Math.min(Math.max(options.maxItems ?? 40, 1), 100);
  return async (evidenceIds: string[], _ownerId = ""): Promise<Evidence[]> => {
    const ids = [...new Set(evidenceIds)];
    if (ids.length > maxItems) throw new Error("Terlalu banyak evidence ID dalam satu permintaan.");
    if (ids.some((id) => !/^ev_[a-f0-9]{24}$/.test(id))) throw new Error("Evidence ID tidak sah.");

    const candidates = await Promise.all(ids.map((id) => store.get(id)));
    const valid: Evidence[] = [];
    for (const candidate of candidates) {
      const parsed = EvidenceSchema.safeParse(candidate);
      if (parsed.success && hasValidIdentity(parsed.data)) valid.push(parsed.data);
    }
    return valid;
  };
}

export function createAzureCorpusEvidenceResolver(accountName: string) {
  if (!/^[a-z0-9]{3,24}$/.test(accountName)) throw new Error("Nama Azure Storage Account tidak sah.");
  const credential = new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
  const container = service.getContainerClient("corpus-derived");
  const store: EvidenceObjectStore = {
    async get(id) {
      const blob = container.getBlobClient(`evidence/${id}.json`);
      try {
        const properties = await blob.getProperties();
        if (!properties.contentLength || properties.contentLength > 60_000) return null;
        const bytes = await blob.downloadToBuffer();
        return JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        const candidate = error as { statusCode?: number };
        if (candidate.statusCode === 404) return null;
        throw error;
      }
    },
  };
  return createEvidenceResolver(store);
}
