export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type CapabilityName = string;
export type ReferencePath = string;
export type StatePath = `state.${string}`;

export type ExpressionOperator =
  | 'add'
  | 'and'
  | 'coalesce'
  | 'concat'
  | 'div'
  | 'empty'
  | 'eq'
  | 'get'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'mul'
  | 'neq'
  | 'not'
  | 'or'
  | 'sub'
  | 'ternary';

export interface LiteralNode {
  kind: 'literal';
  value: JsonPrimitive;
}

export interface ReferenceNode {
  kind: 'reference';
  path: ReferencePath;
}

export interface ExpressionNode {
  kind: 'expression';
  op: ExpressionOperator;
  args: ValueNode[];
}

export interface ObjectNode {
  kind: 'object';
  entries: Record<string, ValueNode>;
}

export interface ArrayNode {
  kind: 'array';
  items: ValueNode[];
}

export type ValueNode = ArrayNode | ExpressionNode | LiteralNode | ObjectNode | ReferenceNode;

export interface SetActionNode {
  kind: 'set';
  path: StatePath;
  value: ValueNode;
}

export interface MergeActionNode {
  kind: 'merge';
  path: StatePath;
  value: ObjectNode;
}

export interface ToggleActionNode {
  kind: 'toggle';
  path: StatePath;
}

export interface RunActionNode {
  kind: 'run';
  action: string;
}

export interface CallActionNode {
  kind: 'call';
  capability: CapabilityName;
  args?: ObjectNode;
  assign?: string;
}

export interface IfActionNode {
  kind: 'if';
  condition: ValueNode;
  then: ActionNode[];
  else?: ActionNode[];
}

export interface TryActionNode {
  kind: 'try';
  body: ActionNode[];
  catch?: ActionNode[];
  finally?: ActionNode[];
}

export type ActionNode =
  | CallActionNode
  | IfActionNode
  | MergeActionNode
  | RunActionNode
  | SetActionNode
  | ToggleActionNode
  | TryActionNode;

export interface ElementViewNode {
  kind: 'element';
  component: string;
  props: Record<string, ValueNode>;
  events: Record<string, ActionNode | ActionNode[]>;
  children: ViewNode[];
}

export interface TextViewNode {
  kind: 'text';
  value: ValueNode;
}

export interface FragmentViewNode {
  kind: 'fragment';
  children: ViewNode[];
}

export interface WhenViewNode {
  kind: 'when';
  condition: ValueNode;
  child: ViewNode;
}

export interface RepeatViewNode {
  kind: 'repeat';
  each: string;
  in: ValueNode;
  key?: ValueNode;
  template: ViewNode;
}

export type ViewNode = ElementViewNode | FragmentViewNode | RepeatViewNode | TextViewNode | WhenViewNode;

export interface DocumentMeta {
  id: string;
  capabilities: CapabilityName[];
}

export interface Document {
  kind: 'document';
  protocol: 'domily-next';
  version: '0.1';
  meta: DocumentMeta;
  state: ObjectNode;
  derived: Record<string, ValueNode>;
  actions: Record<string, ActionNode[]>;
  lifecycle: Record<string, ActionNode | ActionNode[]>;
  view: ViewNode;
}

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

export interface DocumentCodecWithSourceMap<Input = string> extends DocumentCodec<Input> {
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
        throw new Error(`A document codec with id "${codec.id}" is already registered.`);
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
  return extension.startsWith('.') ? extension.slice(1).toLowerCase() : extension.toLowerCase();
}

export function freezeDocument(document: Document): Document {
  return deepFreeze(document);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}
