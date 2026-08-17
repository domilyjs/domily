import type { SourceCodec, SourceCodecRegistry } from './types.ts';

export type {
  ParsedSource,
  SourceCodec,
  SourceCodecIssue,
  SourceCodecRegistry,
  SourceCodecResult,
  SourceLocation,
  SourceMap,
  SourceNodeId,
  SourcePayload,
  SourceRange,
} from './types.ts';

export class SourceCodecRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceCodecRegistryError';
  }
}

/** Creates the codec-neutral lookup layer used by delivery and build tooling. */
export function createSourceCodecRegistry(initial: Iterable<SourceCodec> = []): SourceCodecRegistry {
  const codecsById = new Map<string, SourceCodec>();
  const codecsByExtension = new Map<string, SourceCodec>();
  const codecsByMediaType = new Map<string, SourceCodec>();

  const registry: SourceCodecRegistry = {
    byExtension(extension) {
      return codecsByExtension.get(normalizeExtension(extension));
    },
    byId(id) {
      return codecsById.get(id);
    },
    byMediaType(mediaType) {
      return codecsByMediaType.get(normalizeMediaType(mediaType));
    },
    register(codec) {
      assertCodec(codec);
      if (codecsById.has(codec.id)) {
        throw duplicate('id', codec.id);
      }
      const extensions = codec.extensions.map(normalizeExtension);
      const mediaTypes = codec.mediaTypes.map(normalizeMediaType);
      for (const extension of extensions) {
        if (codecsByExtension.has(extension)) {
          throw duplicate('extension', extension);
        }
      }
      for (const mediaType of mediaTypes) {
        if (codecsByMediaType.has(mediaType)) {
          throw duplicate('media type', mediaType);
        }
      }
      const registered = Object.freeze({
        extensions: Object.freeze([...extensions]),
        id: codec.id,
        mediaTypes: Object.freeze([...mediaTypes]),
        parse: codec.parse,
        ...(codec.serialize ? { serialize: codec.serialize } : {}),
        version: codec.version,
      }) satisfies SourceCodec;
      codecsById.set(registered.id, registered);
      for (const extension of extensions) codecsByExtension.set(extension, registered);
      for (const mediaType of mediaTypes) codecsByMediaType.set(mediaType, registered);
    },
  };

  for (const codec of initial) registry.register(codec);
  return registry;
}

function assertCodec(codec: SourceCodec): void {
  if (!codec || typeof codec !== 'object') {
    throw new SourceCodecRegistryError('codec.invalid', 'A source codec must be an object.');
  }
  if (typeof codec.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(codec.id)) {
    throw new SourceCodecRegistryError('codec.id.invalid', 'A source codec requires a lowercase identifier.');
  }
  if (typeof codec.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(codec.version)) {
    throw new SourceCodecRegistryError('codec.version.invalid', `Source codec "${codec.id}" requires an exact SemVer version.`);
  }
  if (typeof codec.parse !== 'function') {
    throw new SourceCodecRegistryError('codec.parse.invalid', `Source codec "${codec.id}" requires parse().`);
  }
  if (codec.serialize !== undefined && typeof codec.serialize !== 'function') {
    throw new SourceCodecRegistryError('codec.serialize.invalid', `Source codec "${codec.id}" has an invalid serialize().`);
  }
  if (!Array.isArray(codec.extensions) || codec.extensions.length === 0) {
    throw new SourceCodecRegistryError('codec.extensions.invalid', `Source codec "${codec.id}" requires at least one extension.`);
  }
  if (!Array.isArray(codec.mediaTypes) || codec.mediaTypes.length === 0) {
    throw new SourceCodecRegistryError('codec.media-types.invalid', `Source codec "${codec.id}" requires at least one media type.`);
  }
  for (const extension of codec.extensions) normalizeExtension(extension);
  for (const mediaType of codec.mediaTypes) normalizeMediaType(mediaType);
}

function normalizeExtension(value: string): string {
  const normalized = value.startsWith('.') ? value.slice(1) : value;
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(normalized)) {
    throw new SourceCodecRegistryError('codec.extension.invalid', `Invalid codec extension "${value}".`);
  }
  return normalized.toLowerCase();
}

function normalizeMediaType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)) {
    throw new SourceCodecRegistryError('codec.media-type.invalid', `Invalid codec media type "${value}".`);
  }
  return normalized;
}

function duplicate(kind: string, value: string): SourceCodecRegistryError {
  return new SourceCodecRegistryError('codec.duplicate', `A source codec is already registered for ${kind} "${value}".`);
}
