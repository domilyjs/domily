import {
  freezeDocument,
  type ActionNode,
  type CallActionNode,
  type Document,
  type ElementViewNode,
  type ExpressionNode,
  type JsonValue,
  type ObjectNode,
  type ValueNode,
  type ViewNode,
} from '../ast/index.ts';

export { freezeDocument };

export type {
  ActionNode,
  CallActionNode,
  Document,
  ElementViewNode,
  ExpressionNode,
  JsonValue,
  ObjectNode,
  ValueNode,
  ViewNode,
};

export interface SourceLocation {
  line: number;
  column: number;
  offset?: number;
}

export type SourceNodeId = string;

export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

export interface SourceMap {
  codecId: string;
  nodes: Record<SourceNodeId, SourceRange>;
}

/**
 * Read-only provenance sidecar for one parsed document. It is intentionally
 * separate from Document so source positions cannot affect its semantics,
 * hashes, signatures, or serialization.
 */
export interface NodeOrigins {
  get(node: object): readonly SourceNodeId[] | undefined;
  has(node: object): boolean;
}

export interface SourceMappedDocument {
  document: Document;
  sourceMap: SourceMap;
  nodeOrigins: NodeOrigins;
}

export interface CodecIssue {
  code: string;
  message: string;
  location?: SourceLocation;
  path?: string;
}

export type CodecResult<T> =
  | { ok: true; value: T; issues: CodecIssue[] }
  | { ok: false; issues: CodecIssue[] };

/**
 * Experimental boundary between a serialized document format and the normalized
 * protocol AST. Runtime packages depend on this contract, never on a format.
 */
export interface DocumentCodec<Input = string> {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  parse(input: Input): CodecResult<Document>;
  serialize(document: Document): CodecResult<Input>;
}

export interface DocumentCodecWithSourceMap<
  Input = string,
> extends DocumentCodec<Input> {
  parseWithSourceMap(input: Input): CodecResult<SourceMappedDocument>;
}

export interface CodecRegistry {
  register(codec: DocumentCodec): void;
  byExtension(extension: string): DocumentCodec | undefined;
  byId(id: string): DocumentCodec | undefined;
  byMediaType(mediaType: string): DocumentCodec | undefined;
}

export function createCodecRegistry(): CodecRegistry {
  const codecsById = new Map<string, DocumentCodec>();
  const codecsByExtension = new Map<string, DocumentCodec>();
  const codecsByMediaType = new Map<string, DocumentCodec>();

  return {
    register(codec) {
      if (codecsById.has(codec.id)) {
        throw new Error(
          `A document codec with id "${codec.id}" is already registered.`,
        );
      }
      codecsById.set(codec.id, codec);
      for (const extension of codec.extensions) {
        codecsByExtension.set(normalizeExtension(extension), codec);
      }
      for (const mediaType of codec.mediaTypes) {
        codecsByMediaType.set(mediaType.toLowerCase(), codec);
      }
    },
    byExtension(extension) {
      return codecsByExtension.get(normalizeExtension(extension));
    },
    byId(id) {
      return codecsById.get(id);
    },
    byMediaType(mediaType) {
      return codecsByMediaType.get(mediaType.toLowerCase());
    },
  };
}

function normalizeExtension(extension: string): string {
  return extension.startsWith(".")
    ? extension.slice(1).toLowerCase()
    : extension.toLowerCase();
}
