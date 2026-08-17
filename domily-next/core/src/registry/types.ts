import type {
  JsonValue,
  Requirement,
  UiNode,
} from '../pagespec/types.ts';

export type JsonSchemaType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';

/**
 * Deliberately small JSON Schema subset for Catalog and capability contracts.
 * It is data-only and can grow compatibly without turning into an expression
 * language.
 */
export interface JsonSchema {
  readonly additionalProperties?: boolean | JsonSchema;
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
  readonly items?: JsonSchema;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
}

export interface ScopeManifest {
  readonly name: string;
  readonly mode: 'read' | 'readwrite';
  readonly value?: JsonSchema;
}

export interface SlotManifest {
  readonly maxItems?: number;
  readonly minItems?: number;
}

export interface EventManifest {
  readonly description?: string;
  readonly payload?: JsonSchema;
}

export interface BindingManifest {
  readonly mode: 'read' | 'readwrite';
  readonly value?: JsonSchema;
  /** Required for readwrite bindings; interpreted only by a trusted renderer. */
  readonly write?: {
    readonly event: string;
    readonly valuePath: string;
  };
}

export interface ComponentManifest {
  readonly bindings?: Readonly<Record<string, BindingManifest>>;
  readonly children?: SlotManifest;
  readonly description: string;
  readonly events?: Readonly<Record<string, EventManifest>>;
  readonly examples?: readonly UiNode[];
  readonly props?: JsonSchema;
  readonly slots?: Readonly<Record<string, SlotManifest>>;
  readonly styleForwarding?: {
    readonly className?: boolean;
    readonly style?: boolean;
  };
}

export interface ComponentCatalogManifest {
  readonly components: Readonly<Record<string, ComponentManifest>>;
  readonly delivery?: { readonly remotePage: boolean };
  readonly description?: string;
  readonly id: string;
  readonly namespace: string;
  readonly schema: 'domily.component-catalog/v1';
  readonly version: string;
}

export interface CapabilityManifest {
  readonly description: string;
  readonly examples?: readonly JsonValue[];
  readonly id: string;
  readonly input?: JsonSchema;
  readonly invocation: {
    readonly localPage: boolean;
    readonly remotePage: boolean;
  };
  readonly output?: JsonSchema;
  readonly version: string;
}

export interface CapabilityCatalogManifest {
  readonly capabilities: readonly CapabilityManifest[];
  readonly description?: string;
  readonly id: string;
  readonly schema: 'domily.capability-catalog/v1';
  readonly version: string;
}

export interface ExtensionManifest {
  readonly config: JsonSchema;
  readonly delivery?: { readonly remotePage: boolean };
  readonly description: string;
  readonly id: string;
  readonly requires?: {
    readonly capabilities?: readonly Requirement[];
    readonly catalogs?: readonly Requirement[];
  };
  readonly schema: 'domily.extension/v1';
  readonly scopes?: readonly ScopeManifest[];
  readonly version: string;
}

export interface RegisteredComponentCatalog {
  readonly manifest: ComponentCatalogManifest;
}

export interface RegisteredCapability {
  readonly catalog: CapabilityCatalogManifest;
  readonly manifest: CapabilityManifest;
}

export interface RegisteredExtension {
  readonly manifest: ExtensionManifest;
}

export interface ResolvedComponent {
  readonly catalog: ComponentCatalogManifest;
  readonly component: ComponentManifest;
  readonly type: string;
}

/** Immutable registry view captured for one normalize/mount operation. */
export interface PageRegistrySnapshot {
  readonly revision: number;
  resolveCapability(requirement: Requirement): RegisteredCapability | undefined;
  resolveCatalog(requirement: Requirement): RegisteredComponentCatalog | undefined;
  resolveComponent(type: string): ResolvedComponent | undefined;
  resolveExtension(requirement: Requirement): RegisteredExtension | undefined;
}

export interface PageRegistry extends PageRegistrySnapshot {
  registerCapabilityCatalog(manifest: CapabilityCatalogManifest): void;
  registerComponentCatalog(manifest: ComponentCatalogManifest): void;
  registerExtension(manifest: ExtensionManifest): void;
  snapshot(): PageRegistrySnapshot;
}
