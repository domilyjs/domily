import type { SourcePayload } from '../codec/types.ts';
import {
  PageDeliveryError,
  type PageEnvelope,
  type PageEnvelopeCacheEntry,
  type PageEnvelopeCachePolicy,
  type PageEnvelopeCodec,
  type PageEnvelopeSignature,
} from './types.ts';

const envelopeKeys = new Set([
  'cache', 'codec', 'documentId', 'expiresAt', 'issuedAt', 'pageSpec', 'payload', 'payloadHash', 'revision', 'schema', 'signature',
]);
const codecKeys = new Set(['id', 'mediaType', 'version']);
const cacheKeys = new Set(['maxAgeSeconds', 'staleWhileRevalidateSeconds']);
const signatureKeys = new Set(['algorithm', 'keyId', 'value']);
const textPayloadKeys = new Set(['kind', 'text']);
const binaryPayloadKeys = new Set(['bytes', 'kind']);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export interface PageEnvelopeValidationOptions {
  readonly maxCacheAgeSeconds?: number;
  readonly maxPayloadBytes?: number;
  readonly maxStaleWhileRevalidateSeconds?: number;
}

/** Validates and defensively copies an envelope before it reaches a codec or cache. */
export function clonePageEnvelope(input: unknown, options: PageEnvelopeValidationOptions = {}): PageEnvelope {
  const source = requirePlainRecord(input, 'Envelope');
  assertOnlyKeys(source, envelopeKeys, 'Envelope');
  if (source.schema !== 'domily.envelope/v2') {
    throw invalid('delivery.envelope.schema.invalid', 'Envelope schema must be "domily.envelope/v2".');
  }
  const documentId = requireIdentifier(source.documentId, 'Envelope documentId');
  const revision = requireNonNegativeInteger(source.revision, 'Envelope revision');
  if (source.pageSpec !== 'domily.page/v1') {
    throw invalid('delivery.envelope.pagespec.invalid', 'Envelope pageSpec must be "domily.page/v1".');
  }
  const codec = cloneCodec(source.codec);
  const payload = cloneSourcePayload(source.payload, options.maxPayloadBytes);
  const payloadHash = requireHash(source.payloadHash);
  const cache = cloneCachePolicy(source.cache, options);
  const issuedAt = cloneTimestamp(source.issuedAt, 'issuedAt');
  const expiresAt = cloneTimestamp(source.expiresAt, 'expiresAt');
  if (issuedAt && expiresAt && Date.parse(expiresAt) < Date.parse(issuedAt)) {
    throw invalid('delivery.envelope.time.order.invalid', 'Envelope expiresAt cannot precede issuedAt.');
  }
  const signature = source.signature === undefined ? undefined : cloneSignature(source.signature);

  return Object.freeze({
    cache,
    codec,
    documentId,
    ...(expiresAt ? { expiresAt } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    pageSpec: 'domily.page/v1' as const,
    payload,
    payloadHash,
    revision,
    schema: 'domily.envelope/v2' as const,
    ...(signature ? { signature } : {}),
  });
}

export function clonePageEnvelopeCacheEntry(input: unknown): PageEnvelopeCacheEntry {
  const source = requirePlainRecord(input, 'Envelope cache entry');
  assertOnlyKeys(source, new Set(['acceptedAt', 'envelope', 'registryFingerprint']), 'Envelope cache entry');
  const acceptedAt = requireNonNegativeNumber(source.acceptedAt, 'Envelope cache entry acceptedAt');
  if (typeof source.registryFingerprint !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(source.registryFingerprint)) {
    throw invalid('delivery.cache.fingerprint.invalid', 'Envelope cache entry requires a sha256 registry fingerprint.');
  }
  return Object.freeze({
    acceptedAt,
    envelope: clonePageEnvelope(source.envelope),
    registryFingerprint: source.registryFingerprint,
  });
}

/** Returns a new byte copy so a caller cannot mutate the envelope payload. */
export function payloadBytes(payload: SourcePayload): Uint8Array {
  return payload.kind === 'text'
    ? new TextEncoder().encode(payload.text)
    : new Uint8Array(payload.bytes);
}

/** Canonical signing bytes bind metadata and the exact source bytes, not a decoded PageSpec. */
export function envelopeSignatureBytes(envelope: PageEnvelope): Uint8Array {
  const metadata = JSON.stringify({
    cache: {
      maxAgeSeconds: envelope.cache.maxAgeSeconds,
      ...(envelope.cache.staleWhileRevalidateSeconds === undefined
        ? {}
        : { staleWhileRevalidateSeconds: envelope.cache.staleWhileRevalidateSeconds }),
    },
    codec: {
      id: envelope.codec.id,
      ...(envelope.codec.mediaType === undefined ? {} : { mediaType: envelope.codec.mediaType }),
      version: envelope.codec.version,
    },
    documentId: envelope.documentId,
    ...(envelope.expiresAt === undefined ? {} : { expiresAt: envelope.expiresAt }),
    ...(envelope.issuedAt === undefined ? {} : { issuedAt: envelope.issuedAt }),
    pageSpec: envelope.pageSpec,
    payloadKind: envelope.payload.kind,
    payloadHash: envelope.payloadHash,
    revision: envelope.revision,
    schema: envelope.schema,
  });
  const metadataBytes = new TextEncoder().encode(metadata);
  const sourceBytes = payloadBytes(envelope.payload);
  return joinBytes([
    new TextEncoder().encode('domily.envelope.signature/v2\0'),
    uint32Bytes(metadataBytes.length),
    metadataBytes,
    uint32Bytes(sourceBytes.length),
    sourceBytes,
  ]);
}

function cloneCodec(input: unknown): PageEnvelopeCodec {
  const source = requirePlainRecord(input, 'Envelope codec');
  assertOnlyKeys(source, codecKeys, 'Envelope codec');
  const id = requireCodecId(source.id);
  const version = requireVersion(source.version);
  const mediaType = source.mediaType === undefined ? undefined : requireMediaType(source.mediaType);
  return Object.freeze({ id, ...(mediaType ? { mediaType } : {}), version });
}

function cloneCachePolicy(input: unknown, options: PageEnvelopeValidationOptions): PageEnvelopeCachePolicy {
  const source = requirePlainRecord(input, 'Envelope cache');
  assertOnlyKeys(source, cacheKeys, 'Envelope cache');
  const maxAgeSeconds = requireNonNegativeInteger(source.maxAgeSeconds, 'Envelope cache maxAgeSeconds');
  const staleWhileRevalidateSeconds = source.staleWhileRevalidateSeconds === undefined
    ? undefined
    : requireNonNegativeInteger(source.staleWhileRevalidateSeconds, 'Envelope cache staleWhileRevalidateSeconds');
  if (options.maxCacheAgeSeconds !== undefined && maxAgeSeconds > options.maxCacheAgeSeconds) {
    throw invalid('delivery.envelope.cache.max-age.exceeded', 'Envelope cache maxAgeSeconds exceeds the host policy.');
  }
  if (options.maxStaleWhileRevalidateSeconds !== undefined
    && staleWhileRevalidateSeconds !== undefined
    && staleWhileRevalidateSeconds > options.maxStaleWhileRevalidateSeconds) {
    throw invalid('delivery.envelope.cache.stale-window.exceeded', 'Envelope staleWhileRevalidateSeconds exceeds the host policy.');
  }
  return Object.freeze({
    maxAgeSeconds,
    ...(staleWhileRevalidateSeconds === undefined ? {} : { staleWhileRevalidateSeconds }),
  });
}

function cloneSignature(input: unknown): PageEnvelopeSignature {
  const source = requirePlainRecord(input, 'Envelope signature');
  assertOnlyKeys(source, signatureKeys, 'Envelope signature');
  if (source.algorithm !== 'Ed25519') {
    throw invalid('delivery.envelope.signature.algorithm.invalid', 'Envelope signature algorithm must be Ed25519.');
  }
  const keyId = requireIdentifier(source.keyId, 'Envelope signature keyId');
  if (typeof source.value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(source.value)) {
    throw invalid('delivery.envelope.signature.value.invalid', 'Envelope signature value must be base64url data.');
  }
  return Object.freeze({ algorithm: 'Ed25519' as const, keyId, value: source.value });
}

export function cloneSourcePayload(input: unknown, maxPayloadBytes?: number): SourcePayload {
  const source = requirePlainRecord(input, 'Envelope payload');
  if (source.kind === 'text') {
    assertOnlyKeys(source, textPayloadKeys, 'Text envelope payload');
    if (typeof source.text !== 'string') {
      throw invalid('delivery.envelope.payload.text.invalid', 'Text envelope payload requires text.');
    }
    const payload = Object.freeze({ kind: 'text' as const, text: source.text });
    assertPayloadSize(payload, maxPayloadBytes);
    return payload;
  }
  if (source.kind === 'binary') {
    assertOnlyKeys(source, binaryPayloadKeys, 'Binary envelope payload');
    if (!(source.bytes instanceof Uint8Array)) {
      throw invalid('delivery.envelope.payload.binary.invalid', 'Binary envelope payload requires Uint8Array bytes.');
    }
    const payload = Object.freeze({ kind: 'binary' as const, bytes: new Uint8Array(source.bytes) });
    assertPayloadSize(payload, maxPayloadBytes);
    return payload;
  }
  throw invalid('delivery.envelope.payload.kind.invalid', 'Envelope payload kind must be text or binary.');
}

function assertPayloadSize(payload: SourcePayload, maxPayloadBytes: number | undefined): void {
  if (maxPayloadBytes === undefined) return;
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 0) {
    throw invalid('delivery.policy.payload-size.invalid', 'Host maxPayloadBytes must be a non-negative safe integer.');
  }
  if (payloadBytes(payload).byteLength > maxPayloadBytes) {
    throw invalid('delivery.envelope.payload.size.exceeded', 'Envelope payload exceeds the host maximum payload size.');
  }
}

function cloneTimestamp(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw invalid('delivery.envelope.time.invalid', `Envelope ${name} must be an ISO-compatible timestamp.`);
  }
  return value;
}

function requireHash(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(value)) {
    throw invalid('delivery.envelope.hash.invalid', 'Envelope payloadHash must use lowercase sha256 hex.');
  }
  return value;
}

function requireCodecId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw invalid('delivery.envelope.codec.id.invalid', 'Envelope codec id must be lowercase.');
  }
  return value;
}

function requireVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw invalid('delivery.envelope.codec.version.invalid', 'Envelope codec version must be exact SemVer.');
  }
  return value;
}

function requireMediaType(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value)) {
    throw invalid('delivery.envelope.codec.media-type.invalid', 'Envelope codec mediaType is invalid.');
  }
  return value.toLowerCase();
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(value)) {
    throw invalid('delivery.envelope.identifier.invalid', `${label} must be a non-empty safe identifier.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid('delivery.envelope.integer.invalid', `${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid('delivery.cache.accepted-at.invalid', `${label} must be a non-negative finite number.`);
  }
  return value;
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('delivery.envelope.object.invalid', `${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid('delivery.envelope.object.prototype.invalid', `${label} must use a plain object prototype.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor) || unsafeKeys.has(key) || !allowed.has(key)) {
      throw invalid('delivery.envelope.field.invalid', `${label} cannot contain field "${key}".`);
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid('delivery.envelope.field.invalid', `${label} cannot contain symbol fields.`);
  }
}

function uint32Bytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw invalid('delivery.envelope.size.invalid', 'Envelope signing input exceeds the supported size.');
  }
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function invalid(code: string, message: string): PageDeliveryError {
  return new PageDeliveryError(code, message);
}
