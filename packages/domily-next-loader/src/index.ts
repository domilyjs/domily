import { freezeDocument, type CodecIssue, type CodecRegistry, type Document } from '@domily/next-ast';

export interface DocumentCachePolicy {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
}

export interface DocumentEnvelope {
  id: string;
  revision: number;
  codec: string;
  contentHash: string;
  issuedAt: string;
  cache: DocumentCachePolicy;
  payload: string;
  signature?: string;
}

export interface CachedDocument {
  envelope: DocumentEnvelope;
  document: Document;
  storedAt: number;
}

export interface DocumentStore {
  delete(id: string): Promise<void>;
  get(id: string): Promise<CachedDocument | undefined>;
  put(document: CachedDocument): Promise<void>;
}

export interface ValidationResult {
  ok: boolean;
  issues: CodecIssue[];
}

export type VerifyEnvelope = (envelope: DocumentEnvelope) => boolean | Promise<boolean>;
export type DocumentFetcher = (id: string) => Promise<DocumentEnvelope>;
export type DocumentValidator = (document: Document) => ValidationResult;

export interface DocumentLoaderOptions {
  codecs: CodecRegistry;
  fetchEnvelope?: DocumentFetcher;
  now?: () => number;
  store: DocumentStore;
  validate: DocumentValidator;
  verifyEnvelope?: VerifyEnvelope;
}

export interface LoadedDocument {
  document: Document;
  envelope: DocumentEnvelope;
  revalidate?: Promise<RevalidationResult>;
  source: 'cache' | 'network';
  stale: boolean;
}

export type RevalidationResult =
  | { ok: true; value: LoadedDocument }
  | { error: unknown; ok: false };

export class DocumentLoadError extends Error {
  constructor(
    message: string,
    readonly issues: CodecIssue[] = [],
  ) {
    super(message);
  }
}

/**
 * App-shell boundary for delivery concerns. It validates and caches an AST
 * before returning it; renderers only receive the returned Document.
 */
export class DocumentLoader {
  private readonly now: () => number;

  constructor(private readonly options: DocumentLoaderOptions) {
    this.now = options.now ?? Date.now;
  }

  async load(id: string): Promise<LoadedDocument> {
    const cached = await this.readCachedDocument(id);
    if (cached && this.isFresh(cached)) {
      return {
        ...toLoadedDocument(cached, 'cache', false),
        ...(this.options.fetchEnvelope ? { revalidate: this.revalidate(id) } : {}),
      };
    }

    try {
      return await this.fetchAndAccept(id);
    } catch (error) {
      if (cached && this.isStaleButUsable(cached)) {
        return toLoadedDocument(cached, 'cache', true);
      }
      throw error;
    }
  }

  async accept(envelope: DocumentEnvelope): Promise<LoadedDocument> {
    validateEnvelope(envelope);
    const expectedHash = await sha256ContentHash(envelope.payload);
    if (envelope.contentHash !== expectedHash) {
      throw new DocumentLoadError('Document envelope contentHash does not match its raw payload.');
    }
    if (this.options.verifyEnvelope && !(await this.options.verifyEnvelope(envelope))) {
      throw new DocumentLoadError('Document envelope signature verification failed.');
    }

    const codec = this.options.codecs.byId(envelope.codec);
    if (!codec) {
      throw new DocumentLoadError(`Document codec "${envelope.codec}" is not registered.`);
    }
    const parsed = codec.parse(envelope.payload);
    if (!parsed.ok) {
      throw new DocumentLoadError('Document payload could not be decoded.', parsed.issues);
    }
    if (parsed.value.meta.id !== envelope.id) {
      throw new DocumentLoadError('Document envelope id does not match the decoded document id.');
    }

    const document = freezeDocument(parsed.value);
    const validation = this.options.validate(document);
    if (!validation.ok) {
      throw new DocumentLoadError('Decoded document failed host validation.', validation.issues);
    }

    const cached: CachedDocument = { document, envelope, storedAt: this.now() };
    await this.options.store.put(cached);
    return toLoadedDocument(cached, 'network', false);
  }

  private async fetchAndAccept(id: string): Promise<LoadedDocument> {
    if (!this.options.fetchEnvelope) {
      throw new DocumentLoadError(`No document fetcher is configured for "${id}".`);
    }
    const envelope = await this.options.fetchEnvelope(id);
    if (envelope.id !== id) {
      throw new DocumentLoadError(`Fetcher returned document "${envelope.id}" for requested id "${id}".`);
    }
    return this.accept(envelope);
  }

  private async readCachedDocument(id: string): Promise<CachedDocument | undefined> {
    const cached = await this.options.store.get(id);
    if (!cached) {
      return undefined;
    }
    const validation = this.options.validate(cached.document);
    if (validation.ok) {
      return { ...cached, document: freezeDocument(cached.document) };
    }
    await this.options.store.delete(id);
    return undefined;
  }

  private async revalidate(id: string): Promise<RevalidationResult> {
    try {
      return { ok: true, value: await this.fetchAndAccept(id) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  private isFresh(cached: CachedDocument): boolean {
    return this.ageInMilliseconds(cached) <= cached.envelope.cache.maxAgeSeconds * 1_000;
  }

  private isStaleButUsable(cached: CachedDocument): boolean {
    const staleWindow = cached.envelope.cache.staleWhileRevalidateSeconds ?? 0;
    const allowedAge = cached.envelope.cache.maxAgeSeconds + staleWindow;
    return this.ageInMilliseconds(cached) <= allowedAge * 1_000;
  }

  private ageInMilliseconds(cached: CachedDocument): number {
    return Math.max(0, this.now() - cached.storedAt);
  }
}

export class MemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, CachedDocument>();

  async delete(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async get(id: string): Promise<CachedDocument | undefined> {
    return this.documents.get(id);
  }

  async put(document: CachedDocument): Promise<void> {
    this.documents.set(document.envelope.id, document);
  }
}

export interface IndexedDbDocumentStoreOptions {
  databaseName?: string;
  indexedDb?: IDBFactory;
  storeName?: string;
}

export class IndexedDbDocumentStore implements DocumentStore {
  private readonly databaseName: string;
  private readonly indexedDb: IDBFactory;
  private readonly storeName: string;

  constructor(options: IndexedDbDocumentStoreOptions = {}) {
    if (!options.indexedDb && !globalThis.indexedDB) {
      throw new Error('IndexedDB is unavailable in this environment.');
    }
    this.databaseName = options.databaseName ?? 'domily-next-documents';
    this.indexedDb = options.indexedDb ?? globalThis.indexedDB;
    this.storeName = options.storeName ?? 'documents';
  }

  async delete(id: string): Promise<void> {
    await this.runRequest('readwrite', (store) => store.delete(id));
  }

  async get(id: string): Promise<CachedDocument | undefined> {
    return this.runRequest('readonly', (store) => store.get(id));
  }

  async put(document: CachedDocument): Promise<void> {
    await this.runRequest('readwrite', (store) => store.put(document));
  }

  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, 1);
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName, { keyPath: 'envelope.id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  private async runRequest<T>(
    mode: IDBTransactionMode,
    requestStore: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(this.storeName, mode);
        const request = requestStore(transaction.objectStore(this.storeName));
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
        request.onsuccess = () => resolve(request.result);
      });
    } finally {
      database.close();
    }
  }
}

export async function sha256ContentHash(payload: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256-${hex}`;
}

function validateEnvelope(envelope: DocumentEnvelope): void {
  const issue = (message: string) => {
    throw new DocumentLoadError(message);
  };
  if (!envelope.id) issue('Document envelope id is required.');
  if (!Number.isInteger(envelope.revision) || envelope.revision < 0) {
    issue('Document envelope revision must be a non-negative integer.');
  }
  if (!envelope.codec) issue('Document envelope codec is required.');
  if (!envelope.contentHash.startsWith('sha256-')) issue('Document envelope contentHash must use sha256-.');
  if (!Number.isFinite(Date.parse(envelope.issuedAt))) issue('Document envelope issuedAt must be an ISO timestamp.');
  if (!Number.isFinite(envelope.cache.maxAgeSeconds) || envelope.cache.maxAgeSeconds < 0) {
    issue('Document envelope cache.maxAgeSeconds must be non-negative.');
  }
  const staleWindow = envelope.cache.staleWhileRevalidateSeconds;
  if (staleWindow !== undefined && (!Number.isFinite(staleWindow) || staleWindow < 0)) {
    issue('Document envelope cache.staleWhileRevalidateSeconds must be non-negative.');
  }
}

function toLoadedDocument(cached: CachedDocument, source: LoadedDocument['source'], stale: boolean): LoadedDocument {
  return { document: cached.document, envelope: cached.envelope, source, stale };
}
