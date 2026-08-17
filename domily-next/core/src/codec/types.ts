import type { JsonValue } from '../pagespec/types.ts';

/** A stable identity assigned by a source codec while it parses source text or bytes. */
export type SourceNodeId = string;

export interface SourceLocation {
  readonly column: number;
  readonly line: number;
  readonly offset: number;
}

export interface SourceRange {
  readonly end: SourceLocation;
  readonly start: SourceLocation;
}

/**
 * Codec-owned source locations. Node IDs are allocated during parsing, before
 * PageSpec normalization can rearrange or reject values.
 */
export interface SourceMap {
  readonly codecId: string;
  readonly nodes: Readonly<Record<SourceNodeId, SourceRange>>;
}

export type SourcePayload =
  | { readonly kind: 'binary'; readonly bytes: Uint8Array }
  | { readonly kind: 'text'; readonly text: string };

export interface ParsedSource {
  readonly payload: SourcePayload;
  readonly sourceMap?: SourceMap;
  /** A codec parses only generic JSON-compatible data; PageSpec owns semantics. */
  readonly value: JsonValue;
}

export interface SourceCodecIssue {
  readonly code: string;
  readonly location?: SourceLocation;
  readonly message: string;
  readonly nodeId?: SourceNodeId;
  readonly path?: string;
}

export type SourceCodecResult<T> =
  | { readonly issues: readonly []; readonly ok: true; readonly value: T }
  | { readonly issues: readonly SourceCodecIssue[]; readonly ok: false };

/**
 * A format adapter. It has no PageSpec, Catalog, capability, or DOM behavior;
 * every format reaches the same normalizer after parse succeeds.
 */
export interface SourceCodec {
  readonly extensions: readonly string[];
  readonly id: string;
  readonly mediaTypes: readonly string[];
  /** Exact parser semantics used by delivery envelopes; not a PageSpec version. */
  readonly version: string;
  parse(payload: SourcePayload): SourceCodecResult<ParsedSource>;
  serialize?(value: JsonValue): SourceCodecResult<SourcePayload>;
}

export interface SourceCodecRegistry {
  byExtension(extension: string): SourceCodec | undefined;
  byId(id: string): SourceCodec | undefined;
  byMediaType(mediaType: string): SourceCodec | undefined;
  register(codec: SourceCodec): void;
}
