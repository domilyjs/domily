import type {
  ParsedSource,
  SourceCodec,
  SourceMap,
} from '../codec/types.ts';
import { extensionScopeContractsMatch } from '../extensions/registry.ts';
import type {
  PageExtensionRuntimeAvailability,
  PageExtensionRuntimeAvailabilityEntry,
} from '../extensions/types.ts';
import { normalizePageSpec } from '../pagespec/normalize.ts';
import type {
  JsonValue,
  NormalizedPageSpec,
} from '../pagespec/types.ts';
import type {
  PageRegistry,
  PageRegistrySnapshot,
  ScopeManifest,
} from '../registry/types.ts';
import {
  clonePageEnvelope,
  clonePageEnvelopeCacheEntry,
  cloneSourcePayload,
} from './envelope.ts';
import { hashDeliveryFingerprint, verifyPageEnvelopeIntegrity } from './integrity.ts';
import {
  PageDeliveryError,
  type DeliveredPage,
  type PageDeliveryClient,
  type PageDeliveryClientOptions,
  type PageDeliveryLoadOptions,
  type PageDeliverySource,
  type PageEnvelope,
  type PageEnvelopeCacheEntry,
  type PageEnvelopeCacheVersion,
  type PageDeliveryScope,
} from './types.ts';

const defaultMaxPayloadBytes = 1_048_576;
const defaultMaxCacheAgeSeconds = 60 * 60 * 24 * 31;
const defaultMaxStaleWhileRevalidateSeconds = 60 * 60 * 24 * 31;

type RevisionWatermark =
  | { readonly kind: 'missing' }
  | { readonly kind: 'untrusted' }
  | { readonly entry: PageEnvelopeCacheEntry; readonly kind: 'verified' };

/**
 * Creates the codec-neutral remote delivery layer. It accepts raw envelopes,
 * never an AST or renderer implementation, and re-parses cached payloads.
 */
export function createPageDeliveryClient(options: PageDeliveryClientOptions): PageDeliveryClient {
  return new DomilyPageDeliveryClient(options);
}

class DomilyPageDeliveryClient implements PageDeliveryClient {
  private readonly constraints: Required<Pick<PageDeliveryClientOptions,
    'maxCacheAgeSeconds' | 'maxPayloadBytes' | 'maxStaleWhileRevalidateSeconds'>>;
  constructor(private readonly options: PageDeliveryClientOptions) {
    assertNamespace(options.cacheNamespace);
    this.constraints = {
      maxCacheAgeSeconds: options.maxCacheAgeSeconds ?? defaultMaxCacheAgeSeconds,
      maxPayloadBytes: options.maxPayloadBytes ?? defaultMaxPayloadBytes,
      maxStaleWhileRevalidateSeconds: options.maxStaleWhileRevalidateSeconds ?? defaultMaxStaleWhileRevalidateSeconds,
    };
    for (const [name, value] of Object.entries(this.constraints)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new PageDeliveryError('delivery.policy.invalid', `${name} must be a non-negative safe integer.`);
      }
    }
  }

  async accept(input: unknown): Promise<DeliveredPage> {
    const acceptedAt = this.now();
    const accepted = await this.decode(input, 'network', acceptedAt);
    await this.persist(accepted);
    return accepted;
  }

  async getCached(documentId: string): Promise<DeliveredPage | undefined> {
    assertDocumentId(documentId);
    return this.readCached(documentId);
  }

  async load(documentId: string, loadOptions: PageDeliveryLoadOptions = {}): Promise<DeliveredPage> {
    assertDocumentId(documentId);
    const cached = await this.readCached(documentId);
    if (cached && !cached.stale) {
      return cached;
    }
    try {
      return await this.revalidate(documentId, loadOptions);
    } catch (error) {
      if (cached) {
        return cached;
      }
      throw error;
    }
  }

  async revalidate(documentId: string, loadOptions: PageDeliveryLoadOptions = {}): Promise<DeliveredPage> {
    assertDocumentId(documentId);
    const fetcher = loadOptions.fetcher ?? this.options.fetcher;
    if (!fetcher) {
      throw new PageDeliveryError('delivery.fetcher.missing', `No envelope fetcher is available for "${documentId}".`);
    }
    let input: unknown;
    try {
      input = await fetcher({ documentId, ...(loadOptions.signal ? { signal: loadOptions.signal } : {}) });
    } catch (error) {
      throw new PageDeliveryError('delivery.fetch.failed', `Unable to fetch remote envelope "${documentId}".`, error);
    }
    if (input === undefined || input === null) {
      throw new PageDeliveryError('delivery.fetch.empty', `Remote envelope "${documentId}" was not returned.`);
    }
    const acceptedAt = this.now();
    const accepted = await this.decode(input, 'network', acceptedAt);
    if (accepted.envelope.documentId !== documentId) {
      throw new PageDeliveryError(
        'delivery.document.id.mismatch',
        `Fetched envelope id "${accepted.envelope.documentId}" does not match requested id "${documentId}".`,
      );
    }
    await this.persist(accepted);
    return accepted;
  }

  private async readCached(documentId: string): Promise<DeliveredPage | undefined> {
    const store = this.options.store;
    if (!store) return undefined;
    let entry: PageEnvelopeCacheEntry | undefined;
    try {
      const stored = await store.get(this.options.cacheNamespace, documentId);
      if (!stored) return undefined;
      entry = clonePageEnvelopeCacheEntry(stored);
    } catch {
      return undefined;
    }
    if (entry.envelope.documentId !== documentId) {
      return undefined;
    }
    const freshness = this.cacheState(entry.envelope);
    if (freshness === 'expired') {
      // Keep a verified-or-to-be-reverified record as a revision watermark.
      // It must never be rendered once its signed lifetime has elapsed.
      return undefined;
    }
    try {
      const decoded = await this.decode(entry.envelope, 'cache', entry.acceptedAt);
      const source: PageDeliverySource = freshness === 'stale' ? 'stale-cache' : 'cache';
      return Object.freeze({ ...decoded, source, stale: freshness === 'stale' });
    } catch {
      // A corrupt cache entry is never returned. Do not delete here: a racing
      // successful revalidation may already have replaced this key.
      return undefined;
    }
  }

  private async decode(input: unknown, source: PageDeliverySource, acceptedAt: number): Promise<DeliveredPage> {
    const envelope = clonePageEnvelope(input, this.constraints);
    await verifyPageEnvelopeIntegrity(envelope, {
      allowUnsigned: this.options.allowUnsigned === true,
      ...(this.options.verifySignature ? { verifySignature: this.options.verifySignature } : {}),
    });
    if (envelope.expiresAt && Date.parse(envelope.expiresAt) <= this.now()) {
      throw new PageDeliveryError('delivery.envelope.expired', `Envelope "${envelope.documentId}" has expired.`);
    }
    const registry = resolveRegistry(this.options.registry);
    const scopes = resolveScopes(this.options.scopes);
    const codec = this.resolveCodec(envelope);
    const parsed = await parseEnvelope(codec, envelope);
    const normalized = normalizePageSpec(parsed.value, {
      origin: 'remote',
      registry,
      scopes: publicScopeManifests(scopes),
    });
    if (!normalized.ok) {
      throw new PageDeliveryError(
        'delivery.pagespec.invalid',
        normalized.issues[0]?.message ?? 'Remote PageSpec validation failed.',
        normalized.issues,
      );
    }
    const extensionRuntimes = resolveActiveExtensionRuntimes(
      normalized.value,
      registry,
      this.options.extensionRuntimes,
    );
    if (normalized.value.id !== envelope.documentId) {
      throw new PageDeliveryError(
        'delivery.page.id.mismatch',
        `PageSpec id "${normalized.value.id}" does not match envelope documentId "${envelope.documentId}".`,
      );
    }
    const registryFingerprint = await dependencyFingerprint(normalized.value, registry, scopes, extensionRuntimes);
    return Object.freeze({
      acceptedAt,
      envelope,
      page: normalized.value,
      parsed,
      registryFingerprint,
      source,
      stale: false,
    });
  }

  private resolveCodec(envelope: PageEnvelope): SourceCodec {
    const codec = this.options.codecs.byId(envelope.codec.id);
    if (!codec) {
      throw new PageDeliveryError('delivery.codec.unregistered', `Envelope codec "${envelope.codec.id}" is not registered locally.`);
    }
    if (codec.version !== envelope.codec.version) {
      throw new PageDeliveryError(
        'delivery.codec.version.mismatch',
        `Envelope codec "${envelope.codec.id}@${envelope.codec.version}" does not match local "${codec.version}".`,
      );
    }
    if (envelope.codec.mediaType
      && !codec.mediaTypes.some((mediaType) => mediaType.toLowerCase() === envelope.codec.mediaType)) {
      throw new PageDeliveryError(
        'delivery.codec.media-type.mismatch',
        `Envelope media type "${envelope.codec.mediaType}" is not declared by codec "${codec.id}".`,
      );
    }
    return codec;
  }

  private cacheState(envelope: PageEnvelope): 'fresh' | 'stale' | 'expired' {
    const now = this.now();
    if (!envelope.issuedAt || !envelope.expiresAt) return 'expired';
    const issuedAt = Date.parse(envelope.issuedAt);
    const expiresAt = Date.parse(envelope.expiresAt);
    if (expiresAt <= now) return 'expired';
    const freshUntil = Math.min(expiresAt, issuedAt + envelope.cache.maxAgeSeconds * 1_000);
    if (now <= freshUntil) return 'fresh';
    const staleWindow = envelope.cache.staleWhileRevalidateSeconds ?? 0;
    const staleUntil = Math.min(
      expiresAt,
      issuedAt + (envelope.cache.maxAgeSeconds + staleWindow) * 1_000,
    );
    return now <= staleUntil ? 'stale' : 'expired';
  }

  private async persist(delivered: DeliveredPage): Promise<void> {
    const store = this.options.store;
    if (!store) return;
    const next = clonePageEnvelopeCacheEntry({
      acceptedAt: delivered.acceptedAt,
      envelope: delivered.envelope,
      registryFingerprint: delivered.registryFingerprint,
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const watermark = await this.readRevisionWatermark(delivered.envelope.documentId);
      if (watermark.kind === 'untrusted') {
        // Do not overwrite an entry whose current identity cannot be checked
        // atomically. A host may explicitly clear a corrupt store entry.
        return;
      }
      const existing = watermark.kind === 'verified' ? watermark.entry : undefined;
      if (existing) {
        if (existing.envelope.revision > delivered.envelope.revision) {
          throw new PageDeliveryError(
            'delivery.revision.rollback',
            `Envelope revision ${delivered.envelope.revision} is older than cached revision ${existing.envelope.revision}.`,
          );
        }
        if (existing.envelope.revision === delivered.envelope.revision) {
          if (existing.envelope.payloadHash !== delivered.envelope.payloadHash) {
            throw new PageDeliveryError(
              'delivery.revision.conflict',
              `Envelope revision ${delivered.envelope.revision} conflicts with the cached payload hash.`,
            );
          }
          return;
        }
      }
      try {
        const stored = await store.compareAndSwap(
          this.options.cacheNamespace,
          delivered.envelope.documentId,
          existing ? cacheVersion(existing) : undefined,
          next,
        );
        if (stored) return;
      } catch {
        // Cache persistence is an availability feature, not permission to reject a verified network page.
        return;
      }
    }
    throw new PageDeliveryError(
      'delivery.cache.concurrent',
      `Cache for "${delivered.envelope.documentId}" changed too often to persist safely.`,
    );
  }

  private async readRevisionWatermark(documentId: string): Promise<RevisionWatermark> {
    const store = this.options.store;
    if (!store) return { kind: 'untrusted' };
    try {
      const stored = await store.get(this.options.cacheNamespace, documentId);
      if (!stored) return { kind: 'missing' };
      const entry = clonePageEnvelopeCacheEntry(stored);
      if (entry.envelope.documentId !== documentId) return { kind: 'untrusted' };
      await verifyPageEnvelopeIntegrity(entry.envelope, {
        allowUnsigned: this.options.allowUnsigned === true,
        ...(this.options.verifySignature ? { verifySignature: this.options.verifySignature } : {}),
      });
      return { entry, kind: 'verified' };
    } catch {
      // An unverified cache value cannot constrain a network envelope.
      return { kind: 'untrusted' };
    }
  }

  private now(): number {
    const value = (this.options.now ?? Date.now)();
    if (!Number.isFinite(value) || value < 0) {
      throw new PageDeliveryError('delivery.clock.invalid', 'The delivery clock must return a non-negative finite timestamp.');
    }
    return value;
  }
}

function resolveActiveExtensionRuntimes(
  page: NormalizedPageSpec,
  registry: PageRegistrySnapshot,
  source: PageDeliveryClientOptions['extensionRuntimes'],
): ReadonlyMap<string, PageExtensionRuntimeAvailabilityEntry> {
  const runtimes = resolveExtensionRuntimeSource(source);
  const active = new Map<string, PageExtensionRuntimeAvailabilityEntry>();
  for (const requirement of page.requires.extensions) {
    const extension = registry.resolveExtension(requirement);
    if (!extension) {
      throw new PageDeliveryError(
        'delivery.extension.unresolved',
        `Extension "${requirement.id}" disappeared from the registry snapshot.`,
      );
    }
    const runtime = runtimes?.get(extension.manifest.id);
    if (!runtime) {
      throw new PageDeliveryError(
        'delivery.extension.runtime.missing',
        `Remote extension "${extension.manifest.id}" has no trusted local runtime.`,
      );
    }
    const snapshot = snapshotRuntimeAvailability(runtime, extension.manifest.id);
    if (snapshot.id !== extension.manifest.id || snapshot.version !== extension.manifest.version) {
      throw new PageDeliveryError(
        'delivery.extension.runtime.version.mismatch',
        `Trusted runtime "${snapshot.id}@${snapshot.version}" does not match extension manifest "${extension.manifest.id}@${extension.manifest.version}".`,
      );
    }
    if (extension.manifest.delivery?.remotePage !== true || !snapshot.allowRemote) {
      throw new PageDeliveryError(
        'delivery.extension.runtime.remote.disallowed',
        `Trusted runtime "${extension.manifest.id}" is not available to remote pages.`,
      );
    }
    if (!extensionScopeContractsMatch(snapshot.scopes, extension.manifest.scopes ?? [])) {
      throw new PageDeliveryError(
        'delivery.extension.runtime.scope.mismatch',
        `Trusted runtime "${extension.manifest.id}" does not declare the extension manifest scope contract.`,
      );
    }
    active.set(extension.manifest.id, snapshot);
  }
  return active;
}

function cacheVersion(entry: PageEnvelopeCacheEntry): PageEnvelopeCacheVersion {
  return Object.freeze({
    payloadHash: entry.envelope.payloadHash,
    revision: entry.envelope.revision,
  });
}

async function parseEnvelope(codec: SourceCodec, envelope: PageEnvelope): Promise<ParsedSource> {
  let result: ReturnType<SourceCodec['parse']>;
  try {
    result = codec.parse(cloneSourcePayload(envelope.payload));
  } catch (error) {
    throw new PageDeliveryError('delivery.codec.parse.failed', `Codec "${codec.id}" threw while parsing the envelope.`, error);
  }
  if (!result.ok) {
    throw new PageDeliveryError(
      'delivery.codec.parse.invalid',
      result.issues[0]?.message ?? `Codec "${codec.id}" rejected the envelope payload.`,
      result.issues,
    );
  }
  return cloneParsedSource(result.value, envelope.payload);
}

function resolveRegistry(
  source: PageDeliveryClientOptions['registry'],
): PageRegistrySnapshot {
  const value = typeof source === 'function' ? source() : source;
  if (!value || typeof value.resolveCatalog !== 'function' || typeof value.resolveCapability !== 'function'
    || typeof value.resolveComponent !== 'function' || typeof value.resolveExtension !== 'function') {
    throw new PageDeliveryError('delivery.registry.invalid', 'Delivery requires a valid PageRegistry snapshot.');
  }
  return isPageRegistry(value) ? value.snapshot() : value;
}

function isPageRegistry(value: PageRegistry | PageRegistrySnapshot): value is PageRegistry {
  return typeof (value as PageRegistry).snapshot === 'function';
}

function resolveExtensionRuntimeSource(
  source: PageDeliveryClientOptions['extensionRuntimes'],
): PageExtensionRuntimeAvailability | undefined {
  if (!source) {
    return undefined;
  }
  let value: PageExtensionRuntimeAvailability;
  try {
    value = typeof source === 'function' ? source() : source;
  } catch (error) {
    throw new PageDeliveryError('delivery.extension.runtime.registry.invalid', 'Extension runtime availability could not be resolved.', error);
  }
  if (!value || typeof value.get !== 'function') {
    throw new PageDeliveryError('delivery.extension.runtime.registry.invalid', 'Extension runtime availability requires get().');
  }
  return value;
}

function snapshotRuntimeAvailability(
  value: unknown,
  id: string,
): PageExtensionRuntimeAvailabilityEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PageDeliveryError('delivery.extension.runtime.invalid', `Trusted runtime "${id}" availability is invalid.`);
  }
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || typeof source.version !== 'string' || typeof source.allowRemote !== 'boolean'
    || !Array.isArray(source.scopes)) {
    throw new PageDeliveryError('delivery.extension.runtime.invalid', `Trusted runtime "${id}" availability is invalid.`);
  }
  const scopes = source.scopes.map((scope, index) => {
    const clone = cloneJsonValue(scope, `Trusted runtime "${id}" scope ${index}`) as unknown as ScopeManifest;
    if (!clone || typeof clone !== 'object' || typeof clone.name !== 'string'
      || (clone.mode !== 'read' && clone.mode !== 'readwrite')
      || Object.keys(clone).some((key) => key !== 'mode' && key !== 'name' && key !== 'value')) {
      throw new PageDeliveryError('delivery.extension.runtime.invalid', `Trusted runtime "${id}" scope ${index} is invalid.`);
    }
    return Object.freeze(clone);
  });
  if (new Set(scopes.map((scope) => scope.name)).size !== scopes.length) {
    throw new PageDeliveryError('delivery.extension.runtime.invalid', `Trusted runtime "${id}" declares duplicate scopes.`);
  }
  return Object.freeze({
    allowRemote: source.allowRemote,
    id: source.id,
    scopes: Object.freeze(scopes),
    version: source.version,
  });
}

function resolveScopes(source: PageDeliveryClientOptions['scopes']): readonly PageDeliveryScope[] {
  const values = typeof source === 'function' ? source() : source ?? [];
  if (!Array.isArray(values)) {
    throw new PageDeliveryError('delivery.scopes.invalid', 'Delivery scopes must be an array.');
  }
  const seen = new Set<string>();
  return Object.freeze(values.map((scope, index) => {
    const cloned = cloneDeliveryScope(scope, index);
    if (seen.has(cloned.manifest.name)) {
      throw new PageDeliveryError('delivery.scope.duplicate', `Delivery scope "${cloned.manifest.name}" is declared more than once.`);
    }
    seen.add(cloned.manifest.name);
    return cloned;
  }));
}

function cloneDeliveryScope(scope: PageDeliveryScope, index: number): PageDeliveryScope {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new PageDeliveryError('delivery.scope.invalid', `Delivery scope ${index} is invalid.`);
  }
  const source = scope as unknown as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== 'manifest')) {
    throw new PageDeliveryError('delivery.scope.invalid', `Delivery scope ${index} contains an unknown field.`);
  }
  const value = cloneJsonValue(source.manifest, `Delivery scope ${index} manifest`) as unknown as ScopeManifest;
  if (!value || typeof value !== 'object' || typeof value.name !== 'string'
    || (value.mode !== 'read' && value.mode !== 'readwrite')) {
    throw new PageDeliveryError('delivery.scope.invalid', `Delivery scope ${index} is invalid.`);
  }
  return Object.freeze({ manifest: Object.freeze(value) });
}

function publicScopeManifests(scopes: readonly PageDeliveryScope[]): readonly ScopeManifest[] {
  return scopes.map((scope) => scope.manifest);
}

async function dependencyFingerprint(
  page: NormalizedPageSpec,
  registry: PageRegistrySnapshot,
  scopes: readonly PageDeliveryScope[],
  runtimes: ReadonlyMap<string, PageExtensionRuntimeAvailabilityEntry>,
): Promise<string> {
  const catalogs = page.requires.catalogs.map((requirement) => {
    const resolved = registry.resolveCatalog(requirement);
    if (!resolved) throw new PageDeliveryError('delivery.registry.changed', `Catalog "${requirement.id}" disappeared during delivery.`);
    return resolved.manifest;
  }).sort(compareIdentity);
  const capabilities = page.requires.capabilities.map((requirement) => {
    const resolved = registry.resolveCapability(requirement);
    if (!resolved) throw new PageDeliveryError('delivery.registry.changed', `Capability "${requirement.id}" disappeared during delivery.`);
    return { catalog: resolved.catalog, manifest: resolved.manifest };
  }).sort((left, right) => compareIdentity(left.manifest, right.manifest));
  const extensions = page.requires.extensions.map((requirement) => {
    const resolved = registry.resolveExtension(requirement);
    if (!resolved) throw new PageDeliveryError('delivery.registry.changed', `Extension "${requirement.id}" disappeared during delivery.`);
    const runtime = runtimes.get(resolved.manifest.id);
    if (!runtime) throw new PageDeliveryError('delivery.extension.runtime.missing', `Extension "${resolved.manifest.id}" has no trusted local runtime.`);
    return { manifest: resolved.manifest, runtime };
  }).sort((left, right) => compareIdentity(left.manifest, right.manifest));
  return hashDeliveryFingerprint(canonicalJson({
    catalogs,
    capabilities,
    extensions,
    scopes: scopes
      .map((scope) => scope.manifest)
      .sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

function compareIdentity(left: { readonly id?: string }, right: { readonly id?: string }): number {
  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PageDeliveryError('delivery.fingerprint.value.invalid', 'Fingerprint input contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') {
    throw new PageDeliveryError('delivery.fingerprint.value.invalid', 'Fingerprint input is not JSON-compatible.');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function cloneParsedSource(source: ParsedSource, payload: PageEnvelope['payload']): ParsedSource {
  return Object.freeze({
    payload: cloneSourcePayload(payload),
    ...(source.sourceMap ? { sourceMap: cloneSourceMap(source.sourceMap) } : {}),
    value: cloneJsonValue(source.value, 'Codec parsed value'),
  });
}

function cloneSourceMap(source: SourceMap): SourceMap {
  if (!source || typeof source.codecId !== 'string' || !source.nodes || typeof source.nodes !== 'object') {
    throw new PageDeliveryError('delivery.codec.source-map.invalid', 'Codec returned an invalid SourceMap.');
  }
  const nodes: Record<string, SourceMap['nodes'][string]> = {};
  for (const [nodeId, range] of Object.entries(source.nodes)) {
    nodes[nodeId] = Object.freeze({
      end: cloneSourceLocation(range.end, nodeId),
      start: cloneSourceLocation(range.start, nodeId),
    });
  }
  return Object.freeze({ codecId: source.codecId, nodes: Object.freeze(nodes) });
}

function cloneSourceLocation(value: unknown, nodeId: string): SourceMap['nodes'][string]['start'] {
  if (!value || typeof value !== 'object') {
    throw new PageDeliveryError('delivery.codec.source-map.invalid', `Codec SourceMap node "${nodeId}" has no location.`);
  }
  const source = value as Record<string, unknown>;
  for (const name of ['column', 'line', 'offset']) {
    if (!Number.isSafeInteger(source[name]) || (source[name] as number) < 0) {
      throw new PageDeliveryError('delivery.codec.source-map.invalid', `Codec SourceMap node "${nodeId}" has an invalid ${name}.`);
    }
  }
  return Object.freeze({ column: source.column as number, line: source.line as number, offset: source.offset as number });
}

function cloneJsonValue(value: unknown, label: string, ancestors = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PageDeliveryError('delivery.json.invalid', `${label} contains a non-finite number.`);
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new PageDeliveryError('delivery.json.invalid', `${label} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) throw new PageDeliveryError('delivery.json.circular', `${label} contains a circular value.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertyNames(value).some((name) => name !== 'length' && !/^\d+$/.test(name))) {
        throw new PageDeliveryError('delivery.json.invalid', `${label} contains a non-index array property.`);
      }
      return value.map((item, index) => {
        if (!Object.hasOwn(value, index)) throw new PageDeliveryError('delivery.json.invalid', `${label} contains a sparse array.`);
        return cloneJsonValue(item, label, ancestors);
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PageDeliveryError('delivery.json.invalid', `${label} must use plain objects.`);
    }
    const output: Record<string, JsonValue> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        throw new PageDeliveryError('delivery.json.invalid', `${label} contains an unsafe field.`);
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: cloneJsonValue(descriptor.value, label, ancestors),
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function assertNamespace(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(value)) {
    throw new PageDeliveryError('delivery.namespace.invalid', 'Delivery cacheNamespace must be a non-empty safe identifier.');
  }
}

function assertDocumentId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(value)) {
    throw new PageDeliveryError('delivery.document.id.invalid', 'Delivery documentId must be a non-empty safe identifier.');
  }
}
