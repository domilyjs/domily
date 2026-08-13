import { type CodecIssue, type CodecRegistry, type Document } from '@domily/next-ast';
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
export type RevalidationResult = {
    ok: true;
    value: LoadedDocument;
} | {
    error: unknown;
    ok: false;
};
export declare class DocumentLoadError extends Error {
    readonly issues: CodecIssue[];
    constructor(message: string, issues?: CodecIssue[]);
}
/**
 * App-shell boundary for delivery concerns. It validates and caches an AST
 * before returning it; renderers only receive the returned Document.
 */
export declare class DocumentLoader {
    private readonly options;
    private readonly now;
    constructor(options: DocumentLoaderOptions);
    load(id: string): Promise<LoadedDocument>;
    accept(envelope: DocumentEnvelope): Promise<LoadedDocument>;
    private fetchAndAccept;
    private readCachedDocument;
    private revalidate;
    private isFresh;
    private isStaleButUsable;
    private ageInMilliseconds;
}
export declare class MemoryDocumentStore implements DocumentStore {
    private readonly documents;
    delete(id: string): Promise<void>;
    get(id: string): Promise<CachedDocument | undefined>;
    put(document: CachedDocument): Promise<void>;
}
export interface IndexedDbDocumentStoreOptions {
    databaseName?: string;
    indexedDb?: IDBFactory;
    storeName?: string;
}
export declare class IndexedDbDocumentStore implements DocumentStore {
    private readonly databaseName;
    private readonly indexedDb;
    private readonly storeName;
    constructor(options?: IndexedDbDocumentStoreOptions);
    delete(id: string): Promise<void>;
    get(id: string): Promise<CachedDocument | undefined>;
    put(document: CachedDocument): Promise<void>;
    private database;
    private runRequest;
}
export declare function sha256ContentHash(payload: string): Promise<string>;
