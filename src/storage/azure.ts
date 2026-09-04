import { DefaultAzureCredential } from "@azure/identity";
import { CryptographyClient, KnownEncryptionAlgorithms } from "@azure/keyvault-keys";
import { BlobServiceClient } from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { QueueServiceClient } from "@azure/storage-queue";

import {
  createSecureUploadService,
  type BlobStore,
  type KeyWrapper,
  type QueuePublisher,
  type UploadMetadata,
  type UploadRepository,
} from "./uploads.js";

type IdempotencyEntity = {
  partitionKey: string;
  rowKey: string;
  requestHash: string;
  uploadId: string;
};

type UploadEntity = UploadMetadata & { partitionKey: string; rowKey: string };

function isConflict(error: unknown) {
  const candidate = error as { statusCode?: number; code?: string };
  return candidate?.statusCode === 409 || candidate?.code === "EntityAlreadyExists";
}

function uploadPartition(ownerHash: string) {
  return `upload-${ownerHash}`;
}

function toEntity(metadata: UploadMetadata): UploadEntity {
  return { ...metadata, partitionKey: uploadPartition(metadata.ownerHash), rowKey: metadata.id };
}

function fromEntity(entity: UploadEntity): UploadMetadata {
  const { partitionKey: _partitionKey, rowKey: _rowKey, ...metadata } = entity;
  return metadata;
}

class AzureUploadRepository implements UploadRepository {
  constructor(private readonly table: TableClient) {}

  async claimIdempotency(input: { ownerHash: string; keyHash: string; requestHash: string; uploadId: string }) {
    const entity: IdempotencyEntity = {
      partitionKey: `idem-${input.ownerHash}`,
      rowKey: input.keyHash,
      requestHash: input.requestHash,
      uploadId: input.uploadId,
    };
    try {
      await this.table.createEntity(entity);
      return { created: true, requestHash: input.requestHash, uploadId: input.uploadId };
    } catch (error) {
      if (!isConflict(error)) throw error;
      const existing = await this.table.getEntity<IdempotencyEntity>(entity.partitionKey, entity.rowKey);
      return { created: false, requestHash: existing.requestHash, uploadId: existing.uploadId };
    }
  }

  async saveUpload(metadata: UploadMetadata) {
    await this.table.createEntity(toEntity(metadata));
  }

  async getUpload(ownerHash: string, id: string) {
    try {
      const entity = await this.table.getEntity<UploadEntity>(uploadPartition(ownerHash), id);
      return fromEntity(entity as UploadEntity);
    } catch (error) {
      const candidate = error as { statusCode?: number };
      if (candidate.statusCode === 404) return null;
      throw error;
    }
  }

  async updateUpload(metadata: UploadMetadata) {
    await this.table.updateEntity(toEntity(metadata), "Replace");
  }

  async listExpired(nowIso: string) {
    const expired: UploadMetadata[] = [];
    for await (const entity of this.table.listEntities<UploadEntity>()) {
      if (entity.partitionKey.startsWith("upload-") && entity.expiresAt <= nowIso) {
        expired.push(fromEntity(entity as UploadEntity));
      }
    }
    return expired;
  }

  async deleteUpload(ownerHash: string, id: string) {
    await this.table.deleteEntity(uploadPartition(ownerHash), id);
  }
}

export async function createAzureSecureUploadService() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim();
  const keyId = process.env.AZURE_KEY_VAULT_KEY_ID?.trim();
  if (!accountName) throw new Error("AZURE_STORAGE_ACCOUNT_NAME wajib diisi.");
  if (!keyId) throw new Error("AZURE_KEY_VAULT_KEY_ID wajib diisi dengan URL/version key RSA.");
  if (!/^[a-z0-9]{3,24}$/.test(accountName)) throw new Error("Nama Azure Storage Account tidak sah.");

  const credential = new DefaultAzureCredential();
  const blobService = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
  const table = new TableClient(`https://${accountName}.table.core.windows.net`, "HukumUploads", credential);
  const queueService = new QueueServiceClient(`https://${accountName}.queue.core.windows.net`, credential);
  const container = blobService.getContainerClient("user-uploads");
  const queueClient = queueService.getQueueClient("hukum-ingest");
  const cryptography = new CryptographyClient(keyId, credential);

  await Promise.all([
    container.createIfNotExists(),
    table.createTable().catch((error: unknown) => {
      if (!isConflict(error)) throw error;
    }),
    queueClient.createIfNotExists(),
  ]);

  const blobStore: BlobStore = {
    async upload(name, bytes, metadata) {
      await container.getBlockBlobClient(name).uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: "application/octet-stream" },
        metadata: {
          iv: metadata["iv"]!,
          authtag: metadata["authTag"]!,
          originalcontenttype: metadata["originalContentType"]!,
          expiresat: metadata["expiresAt"]!,
        },
      });
    },
    async delete(name) {
      await container.deleteBlob(name, { deleteSnapshots: "include" });
    },
    async download(name) {
      return container.getBlobClient(name).downloadToBuffer();
    },
  };

  const publisher: QueuePublisher = {
    async enqueue(message) {
      await queueClient.sendMessage(message);
    },
  };

  const keyWrapper: KeyWrapper = {
    async wrap(key) {
      const result = await cryptography.wrapKey(KnownEncryptionAlgorithms.RSAOaep256, key);
      return result.result;
    },
    async unwrap(key) {
      const result = await cryptography.unwrapKey(KnownEncryptionAlgorithms.RSAOaep256, key);
      return result.result;
    },
  };

  return createSecureUploadService({
    repository: new AzureUploadRepository(table),
    blobStore,
    queue: publisher,
    keyWrapper,
  });
}
