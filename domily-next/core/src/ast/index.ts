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
