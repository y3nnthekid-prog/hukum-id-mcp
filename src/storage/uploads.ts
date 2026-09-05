import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

export type UploadStatus = "awaiting_upload" | "stored" | "queued" | "processing" | "completed" | "failed" | "expired";

export type UploadMetadata = {
  id: string;
  ownerHash: string;
  requestHash: string;
  fileName: string;
  contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  classification: "public" | "internal" | "confidential";
  aiConsent: boolean;
  status: UploadStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  blobName: string | null;
  wrappedKey: string | null;
  iv: string | null;
  authTag: string | null;
};

export interface UploadRepository {
  claimIdempotency(input: {
    ownerHash: string;
    keyHash: string;
    requestHash: string;
    uploadId: string;
  }): Promise<{ created: boolean; requestHash: string; uploadId: string }>;
  saveUpload(metadata: UploadMetadata): Promise<void>;
  getUpload(ownerHash: string, id: string): Promise<UploadMetadata | null>;
  updateUpload(metadata: UploadMetadata): Promise<void>;
  listExpired(nowIso: string): Promise<UploadMetadata[]>;
  deleteUpload(ownerHash: string, id: string): Promise<void>;
}

export interface BlobStore {
  upload(name: string, bytes: Uint8Array, metadata: Record<string, string>): Promise<void>;
  delete(name: string): Promise<void>;
  download?(name: string): Promise<Uint8Array>;
}

export interface QueuePublisher {
  enqueue(message: string): Promise<void>;
}

export interface KeyWrapper {
  wrap(key: Uint8Array): Promise<Uint8Array>;
  unwrap(key: Uint8Array): Promise<Uint8Array>;
}

type CreateUploadInput = {
  fileName: string;
  contentType: UploadMetadata["contentType"];
  sizeBytes: number;
  classification: UploadMetadata["classification"];
  aiConsent: boolean;
  ownerId: string;
  idempotencyKey: string;
};

type UploadServiceDependencies = {
  repository: UploadRepository;
  blobStore: BlobStore;
  queue: QueuePublisher;
  keyWrapper: KeyWrapper;
  now?: () => Date;
  idFactory?: () => string;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function publicJob(metadata: UploadMetadata) {
  return {
    id: metadata.id,
    fileName: metadata.fileName,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    classification: metadata.classification,
    aiConsent: metadata.aiConsent,
    status: metadata.status,
    createdAt: metadata.createdAt,
    expiresAt: metadata.expiresAt,
    completedAt: metadata.completedAt,
  };
}

function assertFileSignature(contentType: UploadMetadata["contentType"], bytes: Uint8Array) {
  const signature = Buffer.from(bytes.subarray(0, 8));
  const isPdf = signature.subarray(0, 5).toString("ascii") === "%PDF-";
  const isZip = signature[0] === 0x50 && signature[1] === 0x4b && [0x03, 0x05, 0x07].includes(signature[2] ?? -1);
  if ((contentType === "application/pdf" && !isPdf) || (contentType.includes("wordprocessingml") && !isZip)) {
    throw new Error("FILE_SIGNATURE_MISMATCH: isi berkas tidak sesuai tipe PDF/DOCX yang dinyatakan.");
  }
}

export function createSecureUploadService({
  repository,
  blobStore,
  queue,
  keyWrapper,
  now = () => new Date(),
  idFactory = randomUUID,
}: UploadServiceDependencies) {
  async function createUpload(input: CreateUploadInput) {
    if (!input.idempotencyKey.trim()) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    if (input.sizeBytes < 1 || input.sizeBytes > 25 * 1024 * 1024) throw new Error("UPLOAD_SIZE_INVALID");
    const ownerHash = hash(input.ownerId).slice(0, 32);
    const requestHash = hash(
      JSON.stringify({
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        classification: input.classification,
        aiConsent: input.aiConsent,
      })
    );
    const claim = await repository.claimIdempotency({
      ownerHash,
      keyHash: hash(input.idempotencyKey),
      requestHash,
      uploadId: idFactory(),
    });
    if (claim.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED: payload berbeda memakai key yang sama.");

    if (!claim.created) {
      const existing = await repository.getUpload(ownerHash, claim.uploadId);
      if (!existing) throw new Error("IDEMPOTENCY_STATE_INCOMPLETE: tiket sebelumnya belum selesai dibuat.");
      return { ...publicJob(existing), uploadUrl: `/v1/uploads/${existing.id}/content` };
    }

    const createdAt = now();
    const metadata: UploadMetadata = {
      id: claim.uploadId,
      ownerHash,
      requestHash,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      classification: input.classification,
      aiConsent: input.aiConsent,
      status: "awaiting_upload",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      completedAt: null,
      blobName: null,
      wrappedKey: null,
      iv: null,
      authTag: null,
    };
    await repository.saveUpload(metadata);
    return { ...publicJob(metadata), uploadUrl: `/v1/uploads/${metadata.id}/content` };
  }

  async function putUpload(input: {
    id: string;
    ownerId: string;
    contentType: UploadMetadata["contentType"];
    bytes: Uint8Array;
  }) {
    const ownerHash = hash(input.ownerId).slice(0, 32);
    const metadata = await repository.getUpload(ownerHash, input.id);
    if (!metadata) throw new Error("UPLOAD_NOT_FOUND");
    if (metadata.status === "queued" || metadata.status === "processing" || metadata.status === "completed") {
      return publicJob(metadata);
    }
    if (input.contentType !== metadata.contentType) throw new Error("CONTENT_TYPE_MISMATCH");
    if (input.bytes.length > metadata.sizeBytes || input.bytes.length > 25 * 1024 * 1024) {
      throw new Error("UPLOAD_SIZE_INVALID");
    }
    assertFileSignature(input.contentType, input.bytes);

    const { iv, encrypted, authTag, wrappedKey } = await (async () => {
      const dataKey = randomBytes(32);
      try {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
        const encrypted = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const wrappedKey = Buffer.from(await keyWrapper.wrap(dataKey));
        return { iv, encrypted, authTag, wrappedKey };
      } finally {
        dataKey.fill(0);
      }
    })();

    const blobName = `${ownerHash}/${metadata.id}.enc`;
    await blobStore.upload(blobName, encrypted, {
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      originalContentType: metadata.contentType,
      expiresAt: metadata.expiresAt,
    });

    let updated: UploadMetadata = {
      ...metadata,
      status: "stored",
      blobName,
      wrappedKey: wrappedKey.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
    await repository.updateUpload(updated);
    await queue.enqueue(
      Buffer.from(JSON.stringify({ type: "extract-upload", uploadId: metadata.id, ownerHash, blobName })).toString("base64")
    );
    updated = { ...updated, status: "queued" };
    await repository.updateUpload(updated);
    return publicJob(updated);
  }

  async function getJob(id: string, ownerId: string) {
    const ownerHash = hash(ownerId).slice(0, 32);
    const metadata = await repository.getUpload(ownerHash, id);
    return metadata ? publicJob(metadata) : null;
  }

  async function decryptUpload(id: string, ownerId: string) {
    const ownerHash = hash(ownerId).slice(0, 32);
    const metadata = await repository.getUpload(ownerHash, id);
    if (!metadata) throw new Error("UPLOAD_NOT_FOUND");
    if (!blobStore.download || !metadata.blobName || !metadata.wrappedKey || !metadata.iv || !metadata.authTag) {
      throw new Error("UPLOAD_NOT_READY");
    }
    let dataKey: Buffer | null = null;
    try {
      dataKey = Buffer.from(await keyWrapper.unwrap(Buffer.from(metadata.wrappedKey, "base64")));
      const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(metadata.iv, "base64"));
      decipher.setAuthTag(Buffer.from(metadata.authTag, "base64"));
      const encrypted = await blobStore.download(metadata.blobName);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } finally {
      dataKey?.fill(0);
    }
  }

  async function sweepExpired(at = now()) {
    const expired = await repository.listExpired(at.toISOString());
    let deleted = 0;
    let failed = 0;
    for (const metadata of expired) {
      try {
        // Hapus wrapped key lebih dahulu. Dengan demikian ciphertext tidak lagi
        // dapat didekripsi walau soft-delete Blob atau retry jaringan menahannya.
        if (metadata.wrappedKey || metadata.iv || metadata.authTag || metadata.status !== "expired") {
          await repository.updateUpload({
            ...metadata,
            status: "expired",
            wrappedKey: null,
            iv: null,
            authTag: null,
          });
        }
        if (metadata.blobName) await blobStore.delete(metadata.blobName);
        await repository.deleteUpload(metadata.ownerHash, metadata.id);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) throw new Error(`SWEEP_INCOMPLETE: ${failed} unggahan gagal dihapus; ${deleted} berhasil.`);
    return { deleted, failed, sweptAt: at.toISOString() };
  }

  return { createUpload, putUpload, getJob, decryptUpload, sweepExpired };
}

export type SecureUploadService = ReturnType<typeof createSecureUploadService>;
