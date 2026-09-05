import assert from "node:assert/strict";
import test from "node:test";

import {
  createSecureUploadService,
  type BlobStore,
  type KeyWrapper,
  type QueuePublisher,
  type UploadMetadata,
  type UploadRepository,
} from "../src/storage/uploads.js";

class MemoryRepository implements UploadRepository {
  readonly idempotency = new Map<string, { requestHash: string; uploadId: string }>();
  readonly uploads = new Map<string, UploadMetadata>();

  async claimIdempotency(input: { ownerHash: string; keyHash: string; requestHash: string; uploadId: string }) {
    const key = `${input.ownerHash}:${input.keyHash}`;
    const existing = this.idempotency.get(key);
    if (existing) return { created: false, ...existing };
    this.idempotency.set(key, { requestHash: input.requestHash, uploadId: input.uploadId });
    return { created: true, requestHash: input.requestHash, uploadId: input.uploadId };
  }

  async saveUpload(metadata: UploadMetadata) {
    this.uploads.set(`${metadata.ownerHash}:${metadata.id}`, metadata);
  }

  async getUpload(ownerHash: string, id: string) {
    return this.uploads.get(`${ownerHash}:${id}`) ?? null;
  }

  async updateUpload(metadata: UploadMetadata) {
    this.uploads.set(`${metadata.ownerHash}:${metadata.id}`, metadata);
  }

  async listExpired(nowIso: string) {
    return [...this.uploads.values()].filter((item) => item.expiresAt <= nowIso);
  }

  async deleteUpload(ownerHash: string, id: string) {
    this.uploads.delete(`${ownerHash}:${id}`);
  }
}

function fixtures() {
  const repository = new MemoryRepository();
  const uploaded = new Map<string, Buffer>();
  const deleted: string[] = [];
  const messages: string[] = [];
  const blobStore: BlobStore = {
    upload: async (name, bytes) => void uploaded.set(name, Buffer.from(bytes)),
    delete: async (name) => void deleted.push(name),
  };
  const queue: QueuePublisher = { enqueue: async (message) => void messages.push(message) };
  const keyWrapper: KeyWrapper = {
    wrap: async (key) => Buffer.from(key).reverse(),
    unwrap: async (key) => Buffer.from(key).reverse(),
  };
  const service = createSecureUploadService({
    repository,
    blobStore,
    queue,
    keyWrapper,
    now: () => new Date("2026-09-05T00:00:00.000Z"),
    idFactory: () => "upload-fixed",
  });
  return { service, repository, uploaded, deleted, messages };
}

const ticket = {
  fileName: "akad.pdf",
  contentType: "application/pdf" as const,
  sizeBytes: 24,
  classification: "confidential" as const,
  aiConsent: true,
  ownerId: "user-1",
  idempotencyKey: "intent-1",
};

test("upload tickets honour idempotency and reject a changed payload", async () => {
  const { service } = fixtures();
  const first = await service.createUpload(ticket);
  const replay = await service.createUpload(ticket);

  assert.equal(first.id, replay.id);
  await assert.rejects(
    () => service.createUpload({ ...ticket, fileName: "different.pdf" }),
    /IDEMPOTENCY_KEY_REUSED/
  );
});

test("PDF content is magic-byte checked, encrypted, queued and redacted from job status", async () => {
  const { service, uploaded, messages } = fixtures();
  await service.createUpload(ticket);
  const plaintext = Buffer.from("%PDF-1.7 confidential");

  const result = await service.putUpload({
    id: "upload-fixed",
    ownerId: "user-1",
    contentType: "application/pdf",
    bytes: plaintext,
  });
  const stored = [...uploaded.values()][0];

  assert.equal(result.status, "queued");
  assert.ok(stored);
  assert.equal(stored?.includes(Buffer.from("confidential")), false);
  assert.equal(messages.length, 1);
  assert.equal("wrappedKey" in result, false);
  assert.equal("blobName" in result, false);
});

test("plaintext data key is zeroed even when key wrapping fails", async () => {
  const repository = new MemoryRepository();
  let capturedKey: Uint8Array | undefined;
  const service = createSecureUploadService({
    repository,
    blobStore: { upload: async () => undefined, delete: async () => undefined },
    queue: { enqueue: async () => undefined },
    keyWrapper: {
      wrap: async (key) => {
        capturedKey = key;
        throw new Error("KEY_WRAP_FAILED");
      },
      unwrap: async (key) => key,
    },
    now: () => new Date("2026-09-05T00:00:00.000Z"),
    idFactory: () => "upload-fixed",
  });
  await service.createUpload(ticket);

  await assert.rejects(
    () =>
      service.putUpload({
        id: "upload-fixed",
        ownerId: "user-1",
        contentType: "application/pdf",
        bytes: Buffer.from("%PDF-1.7 confidential"),
      }),
    /KEY_WRAP_FAILED/
  );
  assert.ok(capturedKey);
  assert.ok([...capturedKey].every((value) => value === 0));
});

test("an extension or MIME label cannot disguise a non-PDF upload", async () => {
  const { service } = fixtures();
  await service.createUpload(ticket);
  await assert.rejects(
    () =>
      service.putUpload({
        id: "upload-fixed",
        ownerId: "user-1",
        contentType: "application/pdf",
        bytes: Buffer.from("not a pdf"),
      }),
    /FILE_SIGNATURE_MISMATCH/
  );
});

test("an owner cannot inspect, replace, or decrypt another owner's upload", async () => {
  const { service } = fixtures();
  await service.createUpload(ticket);

  assert.equal(await service.getJob("upload-fixed", "user-2"), null);
  await assert.rejects(
    () =>
      service.putUpload({
        id: "upload-fixed",
        ownerId: "user-2",
        contentType: "application/pdf",
        bytes: Buffer.from("%PDF-1.7 attacker"),
      }),
    /UPLOAD_NOT_FOUND/
  );
  await assert.rejects(() => service.decryptUpload("upload-fixed", "user-2"), /UPLOAD_NOT_FOUND/);
});

test("expiry deletes both the blob and the wrapped-key metadata", async () => {
  const { service, repository, deleted } = fixtures();
  await service.createUpload(ticket);
  await service.putUpload({
    id: "upload-fixed",
    ownerId: "user-1",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF-1.7 confidential"),
  });

  const result = await service.sweepExpired(new Date("2026-09-06T01:00:00.000Z"));

  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(repository.uploads.size, 0);
  assert.equal(deleted.length, 1);
});

test("expiry erases wrapped keys and continues after one blob deletion fails", async () => {
  const { service, repository } = fixtures();
  await service.createUpload(ticket);
  await service.putUpload({
    id: "upload-fixed",
    ownerId: "user-1",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF-1.7 confidential"),
  });
  const metadata = [...repository.uploads.values()][0]!;
  const second = { ...metadata, id: "upload-second", blobName: "second.enc" };
  await repository.saveUpload(second);

  const failing = createSecureUploadService({
    repository,
    blobStore: {
      upload: async () => undefined,
      delete: async (name) => {
        if (name !== "second.enc") throw new Error("temporary storage failure");
      },
    },
    queue: { enqueue: async () => undefined },
    keyWrapper: { wrap: async (key) => key, unwrap: async (key) => key },
  });

  await assert.rejects(
    () => failing.sweepExpired(new Date("2026-09-06T01:00:00.000Z")),
    /SWEEP_INCOMPLETE/
  );
  const retained = [...repository.uploads.values()][0]!;
  assert.equal(retained.wrappedKey, null);
  assert.equal(retained.status, "expired");
  assert.equal(repository.uploads.size, 1);
});
