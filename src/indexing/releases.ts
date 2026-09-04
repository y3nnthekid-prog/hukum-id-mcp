import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { z } from "zod";

const ConnectorHealthSchema = z.object({
  status: z.enum(["ok", "failed"]),
  fetchedAt: z.string().datetime({ offset: true }),
  documentCount: z.number().int().nonnegative(),
});

export const IndexReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string().regex(/^[a-zA-Z0-9._-]{8,100}$/),
  corpusVersion: z.string().min(1).max(100),
  builtAt: z.string().datetime({ offset: true }),
  connectors: z.record(z.string().min(1), ConnectorHealthSchema),
  failedSources: z.array(z.string()).max(100),
  files: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
  })).min(2).max(20),
});

export type IndexReleaseManifest = z.infer<typeof IndexReleaseManifestSchema>;
export type ActiveIndexPointer = { releaseId: string; manifestPath: string };

export interface IndexReleaseStore {
  putImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  readActive(): Promise<{ value: ActiveIndexPointer | null; etag: string | null }>;
  compareAndSwapActive(value: ActiveIndexPointer, expectedEtag: string | null): Promise<void>;
}

export interface IndexReleaseReader {
  readActive(): Promise<{ value: ActiveIndexPointer | null; etag: string | null }>;
  get(path: string): Promise<Uint8Array | null>;
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateComplete(manifest: IndexReleaseManifest, files: Map<string, Uint8Array>) {
  const unhealthy = Object.entries(manifest.connectors).filter(([, connector]) => connector.status !== "ok");
  if (manifest.failedSources.length > 0 || unhealthy.length > 0 || Object.keys(manifest.connectors).length === 0) {
    throw new Error("Snapshot tidak lengkap: ada connector gagal atau tidak ada status connector.");
  }
  const required = new Set(["lexical.sqlite", "semantic.hnsw"]);
  const declared = new Set(manifest.files.map((file) => file.name));
  for (const name of required) {
    if (!declared.has(name)) throw new Error(`Snapshot tidak lengkap: ${name} wajib tersedia.`);
  }
  if (files.size !== declared.size || [...files.keys()].some((name) => !declared.has(name))) {
    throw new Error("Snapshot tidak lengkap: file aktual dan manifest berbeda.");
  }
  for (const entry of manifest.files) {
    const bytes = files.get(entry.name);
    if (!bytes || bytes.byteLength !== entry.sizeBytes || digest(bytes) !== entry.sha256) {
      throw new Error(`Checksum atau ukuran ${entry.name} tidak cocok.`);
    }
  }
}

/** Uploads immutable release objects and changes the active pointer only after full validation. */
export async function publishIndexRelease(input: {
  store: IndexReleaseStore;
  manifest: IndexReleaseManifest;
  files: Map<string, Uint8Array>;
}) {
  const manifest = IndexReleaseManifestSchema.parse(input.manifest);
  validateComplete(manifest, input.files);
  const prefix = `releases/${manifest.releaseId}`;
  const previous = await input.store.readActive();

  for (const entry of manifest.files) {
    await input.store.putImmutable(
      `${prefix}/${entry.name}`,
      input.files.get(entry.name)!,
      entry.name.endsWith(".sqlite") ? "application/vnd.sqlite3" : "application/octet-stream"
    );
  }
  await input.store.putImmutable(
    `${prefix}/manifest.json`,
    Buffer.from(JSON.stringify(manifest)),
    "application/json"
  );
  const active = { releaseId: manifest.releaseId, manifestPath: `${prefix}/manifest.json` };
  await input.store.compareAndSwapActive(active, previous.etag);
  return active;
}

/** Materializes a verified immutable directory and returns it only after atomic rename. */
export async function materializeActiveIndex(input: { reader: IndexReleaseReader; cacheRoot: string }) {
  const pointer = await input.reader.readActive();
  if (!pointer.value) throw new Error("Belum ada indeks aktif.");
  const expectedManifestPath = `releases/${pointer.value.releaseId}/manifest.json`;
  if (pointer.value.manifestPath !== expectedManifestPath) throw new Error("Pointer indeks aktif tidak sah.");
  const manifestBytes = await input.reader.get(pointer.value.manifestPath);
  if (!manifestBytes || manifestBytes.byteLength > 256_000) throw new Error("Manifest indeks tidak tersedia atau terlalu besar.");
  const manifest = IndexReleaseManifestSchema.parse(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
  if (manifest.releaseId !== pointer.value.releaseId) throw new Error("Release ID pada pointer dan manifest berbeda.");

  const prefix = `releases/${manifest.releaseId}`;
  const files = new Map<string, Uint8Array>();
  for (const entry of manifest.files) {
    const bytes = await input.reader.get(`${prefix}/${entry.name}`);
    if (!bytes) throw new Error(`File indeks ${entry.name} tidak tersedia.`);
    files.set(entry.name, bytes);
  }
  validateComplete(manifest, files);

  await mkdir(input.cacheRoot, { recursive: true });
  const manifestHash = digest(manifestBytes).slice(0, 12);
  const directory = join(input.cacheRoot, `${manifest.releaseId}-${manifestHash}`);
  try {
    await access(directory);
    return { releaseId: manifest.releaseId, directory, manifest };
  } catch {
    // A missing final directory is the normal first-start path.
  }

  const staging = join(input.cacheRoot, `.staging-${manifest.releaseId}-${randomUUID()}`);
  try {
    await mkdir(staging, { recursive: false });
    for (const [name, bytes] of files) await writeFile(join(staging, name), bytes, { flag: "wx" });
    await writeFile(join(staging, "manifest.json"), manifestBytes, { flag: "wx" });
    await rename(staging, directory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { releaseId: manifest.releaseId, directory, manifest };
}

export async function createAzureIndexReleaseStore(accountName: string): Promise<IndexReleaseStore & IndexReleaseReader> {
  if (!/^[a-z0-9]{3,24}$/.test(accountName)) throw new Error("Nama Azure Storage Account tidak sah.");
  const credential = new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
  const container = service.getContainerClient("index-releases");
  await container.createIfNotExists();

  return {
    async putImmutable(path, bytes, contentType) {
      await container.getBlockBlobClient(path).uploadData(bytes, {
        conditions: { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: contentType },
      });
    },
    async readActive() {
      const blob = container.getBlobClient("active.json");
      try {
        const properties = await blob.getProperties();
        const bytes = await blob.downloadToBuffer();
        const value = JSON.parse(bytes.toString("utf8")) as ActiveIndexPointer;
        if (!value.releaseId || !value.manifestPath) throw new Error("Pointer indeks aktif tidak sah.");
        return { value, etag: properties.etag ?? null };
      } catch (error) {
        const candidate = error as { statusCode?: number };
        if (candidate.statusCode === 404) return { value: null, etag: null };
        throw error;
      }
    },
    async get(path) {
      const blob = container.getBlobClient(path);
      try {
        return await blob.downloadToBuffer();
      } catch (error) {
        const candidate = error as { statusCode?: number };
        if (candidate.statusCode === 404) return null;
        throw error;
      }
    },
    async compareAndSwapActive(value, expectedEtag) {
      await container.getBlockBlobClient("active.json").uploadData(Buffer.from(JSON.stringify(value)), {
        conditions: expectedEtag ? { ifMatch: expectedEtag } : { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json", blobCacheControl: "no-cache" },
      });
    },
  };
}
