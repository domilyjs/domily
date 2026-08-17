/** A value that can cross every PageSpec source codec without runtime objects. */
export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LifecycleEvent = 'mounted' | 'unmounted';

/** A locally registered dependency and its optional SemVer compatibility range. */
export interface Requirement {
  id: string;
  range?: string;
}

/** Source formats may use a concise `id@range` string before normalization. */
export type RequirementInput = Requirement | string;

export interface PageRequirements {
  catalogs?: readonly RequirementInput[];
  capabilities?: readonly RequirementInput[];
  extensions?: readonly RequirementInput[];
}

/**
 * A PageSpec event is deliberately one capability invocation, not a workflow
 * language. Complex sequencing belongs to a trusted capability or extension.
 */
export interface CapabilityInvocation {
  capability: string;
  args?: JsonValue;
}

/**
 * Component tree exposed to PageSpec authors. Component-specific semantics are
 * supplied by the active Catalog, not hard-coded into this type.
 */
export interface UiNode {
  type: string;
  props?: Record<string, JsonValue>;
  bind?: Record<string, string>;
  on?: Record<string, CapabilityInvocation>;
  children?: UiNode[];
  slots?: Record<string, UiNode | UiNode[]>;
}

/** The public, codec-independent source model for a Domily page. */
export interface PageSpec {
  schema: 'domily.page/v1';
  id: string;
  requires?: PageRequirements;
  lifecycle?: Partial<Record<LifecycleEvent, CapabilityInvocation>>;
  ui: UiNode;
  extensions?: Record<string, JsonValue>;
}

export interface NormalizedPageRequirements {
  catalogs: Requirement[];
  capabilities: Requirement[];
  extensions: Requirement[];
}

/**
 * Requirement declarations are canonicalized, while `$$` remains escaped so
 * a renderer can distinguish a literal dollar string from a `$scope.path`.
 */
export interface NormalizedPageSpec extends Omit<PageSpec, 'requires'> {
  requires: NormalizedPageRequirements;
}

export interface PageSpecIssue {
  code: string;
  message: string;
  path?: string;
}

export type PageSpecResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: PageSpecIssue[] };
