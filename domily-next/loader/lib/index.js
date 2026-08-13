// src/index.ts
import { freezeDocument } from "@domily/next-ast";

class DocumentLoadError extends Error {
  issues;
  constructor(message, issues = []) {
    super(message);
    this.issues = issues;
  }
}

class DocumentLoader {
  options;
  now;
  constructor(options) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }
  async load(id) {
    const cached = await this.readCachedDocument(id);
    if (cached && this.isFresh(cached)) {
      return {
        ...toLoadedDocument(cached, "cache", false),
        ...this.options.fetchEnvelope ? { revalidate: this.revalidate(id) } : {}
      };
    }
    try {
      return await this.fetchAndAccept(id);
    } catch (error) {
      if (cached && this.isStaleButUsable(cached)) {
        return toLoadedDocument(cached, "cache", true);
      }
      throw error;
    }
  }
  async accept(envelope) {
    validateEnvelope(envelope);
    const expectedHash = await sha256ContentHash(envelope.payload);
    if (envelope.contentHash !== expectedHash) {
      throw new DocumentLoadError("Document envelope contentHash does not match its raw payload.");
    }
    if (this.options.verifyEnvelope && !await this.options.verifyEnvelope(envelope)) {
      throw new DocumentLoadError("Document envelope signature verification failed.");
    }
    const codec = this.options.codecs.byId(envelope.codec);
    if (!codec) {
      throw new DocumentLoadError(`Document codec "${envelope.codec}" is not registered.`);
    }
    const parsed = codec.parse(envelope.payload);
    if (!parsed.ok) {
      throw new DocumentLoadError("Document payload could not be decoded.", parsed.issues);
    }
    if (parsed.value.meta.id !== envelope.id) {
      throw new DocumentLoadError("Document envelope id does not match the decoded document id.");
    }
    const document = freezeDocument(parsed.value);
    const validation = this.options.validate(document);
    if (!validation.ok) {
      throw new DocumentLoadError("Decoded document failed host validation.", validation.issues);
    }
    const cached = { document, envelope, storedAt: this.now() };
    await this.options.store.put(cached);
    return toLoadedDocument(cached, "network", false);
  }
  async fetchAndAccept(id) {
    if (!this.options.fetchEnvelope) {
      throw new DocumentLoadError(`No document fetcher is configured for "${id}".`);
    }
    const envelope = await this.options.fetchEnvelope(id);
    if (envelope.id !== id) {
      throw new DocumentLoadError(`Fetcher returned document "${envelope.id}" for requested id "${id}".`);
    }
    return this.accept(envelope);
  }
  async readCachedDocument(id) {
    const cached = await this.options.store.get(id);
    if (!cached) {
      return;
    }
    const validation = this.options.validate(cached.document);
    if (validation.ok) {
      return { ...cached, document: freezeDocument(cached.document) };
    }
    await this.options.store.delete(id);
    return;
  }
  async revalidate(id) {
    try {
      return { ok: true, value: await this.fetchAndAccept(id) };
    } catch (error) {
      return { ok: false, error };
    }
  }
  isFresh(cached) {
    return this.ageInMilliseconds(cached) <= cached.envelope.cache.maxAgeSeconds * 1000;
  }
  isStaleButUsable(cached) {
    const staleWindow = cached.envelope.cache.staleWhileRevalidateSeconds ?? 0;
    const allowedAge = cached.envelope.cache.maxAgeSeconds + staleWindow;
    return this.ageInMilliseconds(cached) <= allowedAge * 1000;
  }
  ageInMilliseconds(cached) {
    return Math.max(0, this.now() - cached.storedAt);
  }
}

class MemoryDocumentStore {
  documents = new Map;
  async delete(id) {
    this.documents.delete(id);
  }
  async get(id) {
    return this.documents.get(id);
  }
  async put(document) {
    this.documents.set(document.envelope.id, document);
  }
}

class IndexedDbDocumentStore {
  databaseName;
  indexedDb;
  storeName;
  constructor(options = {}) {
    if (!options.indexedDb && !globalThis.indexedDB) {
      throw new Error("IndexedDB is unavailable in this environment.");
    }
    this.databaseName = options.databaseName ?? "domily-next-documents";
    this.indexedDb = options.indexedDb ?? globalThis.indexedDB;
    this.storeName = options.storeName ?? "documents";
  }
  async delete(id) {
    await this.runRequest("readwrite", (store) => store.delete(id));
  }
  async get(id) {
    return this.runRequest("readonly", (store) => store.get(id));
  }
  async put(document) {
    await this.runRequest("readwrite", (store) => store.put(document));
  }
  async database() {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, 1);
      request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName, { keyPath: "envelope.id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }
  async runRequest(mode, requestStore) {
    const database = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(this.storeName, mode);
        const request = requestStore(transaction.objectStore(this.storeName));
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
        request.onsuccess = () => resolve(request.result);
      });
    } finally {
      database.close();
    }
  }
}
async function sha256ContentHash(payload) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256-${hex}`;
}
function validateEnvelope(envelope) {
  const issue = (message) => {
    throw new DocumentLoadError(message);
  };
  if (!envelope.id)
    issue("Document envelope id is required.");
  if (!Number.isInteger(envelope.revision) || envelope.revision < 0) {
    issue("Document envelope revision must be a non-negative integer.");
  }
  if (!envelope.codec)
    issue("Document envelope codec is required.");
  if (!envelope.contentHash.startsWith("sha256-"))
    issue("Document envelope contentHash must use sha256-.");
  if (!Number.isFinite(Date.parse(envelope.issuedAt)))
    issue("Document envelope issuedAt must be an ISO timestamp.");
  if (!Number.isFinite(envelope.cache.maxAgeSeconds) || envelope.cache.maxAgeSeconds < 0) {
    issue("Document envelope cache.maxAgeSeconds must be non-negative.");
  }
  const staleWindow = envelope.cache.staleWhileRevalidateSeconds;
  if (staleWindow !== undefined && (!Number.isFinite(staleWindow) || staleWindow < 0)) {
    issue("Document envelope cache.staleWhileRevalidateSeconds must be non-negative.");
  }
}
function toLoadedDocument(cached, source, stale) {
  return { document: cached.document, envelope: cached.envelope, source, stale };
}
export {
  sha256ContentHash,
  MemoryDocumentStore,
  IndexedDbDocumentStore,
  DocumentLoader,
  DocumentLoadError
};
