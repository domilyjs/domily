import type {
  CapabilityCatalogManifest,
  CapabilityManifest,
  ComponentCatalogManifest,
  ComponentManifest,
  ExtensionManifest,
  PageRegistry,
  PageRegistrySnapshot,
  RegisteredCapability,
  RegisteredComponentCatalog,
  RegisteredExtension,
  ResolvedComponent,
  ScopeManifest,
} from './types.ts';
import type { Requirement } from '../pagespec/types.ts';

export { validateJsonSchema } from './schema.ts';
export type {
  BindingManifest,
  CapabilityCatalogManifest,
  CapabilityManifest,
  ComponentCatalogManifest,
  ComponentManifest,
  EventManifest,
  ExtensionManifest,
  JsonSchema,
  JsonSchemaType,
  PageRegistry,
  PageRegistrySnapshot,
  RegisteredCapability,
  RegisteredComponentCatalog,
  RegisteredExtension,
  ResolvedComponent,
  ScopeManifest,
  SlotManifest,
} from './types.ts';

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const schemaTypes = new Set(['array', 'boolean', 'null', 'number', 'object', 'string']);

export class PageRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PageRegistryError';
  }
}

/**
 * Creates the host-local manifest registry used by PageSpec validation.
 *
 * Registration converts caller-owned input into an immutable JSON snapshot.
 * A PageSpec can therefore never gain permissions because a caller mutates the
 * object it originally passed to the registry.
 */
export function createPageRegistry(): PageRegistry {
  const catalogsById = new Map<string, RegisteredComponentCatalog>();
  const catalogIdByNamespace = new Map<string, string>();
  const componentsByType = new Map<string, ResolvedComponent>();
  const capabilityCatalogsById = new Map<string, CapabilityCatalogManifest>();
  const capabilitiesById = new Map<string, RegisteredCapability>();
  const extensionsById = new Map<string, RegisteredExtension>();
  let revision = 0;

  const currentView = (): PageRegistrySnapshot => createRegistryView(
    revision,
    catalogsById,
    componentsByType,
    capabilitiesById,
    extensionsById,
  );

  return {
    get revision() {
      return revision;
    },

    registerComponentCatalog(input) {
      const manifest = snapshotManifest(input, 'Component Catalog');
      assertComponentCatalog(manifest);
      if (catalogsById.has(manifest.id)) {
        throw duplicate('catalog', manifest.id);
      }
      const existingNamespace = catalogIdByNamespace.get(manifest.namespace);
      if (existingNamespace) {
        throw new PageRegistryError(
          'registry.catalog.namespace.duplicate',
          `Namespace "${manifest.namespace}" is already owned by Catalog "${existingNamespace}".`,
        );
      }

      for (const [name, component] of Object.entries(manifest.components)) {
        assertComponentName(name);
        assertComponentManifest(component, name);
        const type = `${manifest.namespace}.${name}`;
        if (componentsByType.has(type)) {
          throw duplicate('component', type);
        }
      }

      const registered = deepFreeze({ manifest });
      catalogsById.set(manifest.id, registered);
      catalogIdByNamespace.set(manifest.namespace, manifest.id);
      for (const [name, component] of Object.entries(manifest.components)) {
        const type = `${manifest.namespace}.${name}`;
        componentsByType.set(type, deepFreeze({ catalog: manifest, component, type }));
      }
      revision += 1;
    },

    registerCapabilityCatalog(input) {
      const manifest = snapshotManifest(input, 'Capability Catalog');
      assertCapabilityCatalog(manifest);
      if (capabilityCatalogsById.has(manifest.id)) {
        throw duplicate('capability Catalog', manifest.id);
      }
      const seen = new Set<string>();
      for (const capability of manifest.capabilities) {
        assertCapabilityManifest(capability);
        if (seen.has(capability.id) || capabilitiesById.has(capability.id)) {
          throw duplicate('capability', capability.id);
        }
        seen.add(capability.id);
      }
      capabilityCatalogsById.set(manifest.id, manifest);
      for (const capability of manifest.capabilities) {
        capabilitiesById.set(capability.id, deepFreeze({ catalog: manifest, manifest: capability }));
      }
      revision += 1;
    },

    registerExtension(input) {
      const manifest = snapshotManifest(input, 'Extension');
      assertExtensionManifest(manifest);
      if (extensionsById.has(manifest.id)) {
        throw duplicate('extension', manifest.id);
      }
      extensionsById.set(manifest.id, deepFreeze({ manifest }));
      revision += 1;
    },

    resolveCapability(requirement: Requirement) {
      return currentView().resolveCapability(requirement);
    },

    resolveCatalog(requirement: Requirement) {
      return currentView().resolveCatalog(requirement);
    },

    resolveComponent(type: string) {
      return currentView().resolveComponent(type);
    },

    resolveExtension(requirement: Requirement) {
      return currentView().resolveExtension(requirement);
    },

    snapshot() {
      return createRegistryView(
        revision,
        new Map(catalogsById),
        new Map(componentsByType),
        new Map(capabilitiesById),
        new Map(extensionsById),
      );
    },
  };
}

export function isSupportedVersionRange(range: string | undefined): boolean {
  return range === undefined
    || range === '*'
    || /^\d+\.\d+\.\d+$/.test(range)
    || /^(?:\^|~)\d+(?:\.\d+){0,2}$/.test(range);
}

function createRegistryView(
  revision: number,
  catalogsById: ReadonlyMap<string, RegisteredComponentCatalog>,
  componentsByType: ReadonlyMap<string, ResolvedComponent>,
  capabilitiesById: ReadonlyMap<string, RegisteredCapability>,
  extensionsById: ReadonlyMap<string, RegisteredExtension>,
): PageRegistrySnapshot {
  return Object.freeze({
    revision,
    resolveCapability(requirement: Requirement) {
      const capability = capabilitiesById.get(requirement.id);
      return capability && versionSatisfies(capability.manifest.version, requirement.range) ? capability : undefined;
    },
    resolveCatalog(requirement: Requirement) {
      const catalog = catalogsById.get(requirement.id);
      return catalog && versionSatisfies(catalog.manifest.version, requirement.range) ? catalog : undefined;
    },
    resolveComponent(type: string) {
      return componentsByType.get(type);
    },
    resolveExtension(requirement: Requirement) {
      const extension = extensionsById.get(requirement.id);
      return extension && versionSatisfies(extension.manifest.version, requirement.range) ? extension : undefined;
    },
  });
}

function assertComponentCatalog(manifest: ComponentCatalogManifest): void {
  assertRecord(manifest, 'Component Catalog');
  assertOnlyKeys(manifest, ['components', 'delivery', 'description', 'id', 'namespace', 'schema', 'version'], 'Component Catalog');
  if (manifest.schema !== 'domily.component-catalog/v1') {
    throw invalid('registry.catalog.schema.invalid', 'Component Catalog schema must be "domily.component-catalog/v1".');
  }
  assertManifestIdentity(manifest.id, manifest.version, 'Component Catalog');
  assertNamespace(manifest.namespace);
  assertOptionalString(manifest.description, 'Component Catalog description');
  assertDelivery(manifest.delivery, 'Component Catalog delivery');
  if (!isRecord(manifest.components) || Object.keys(manifest.components).length === 0) {
    throw invalid('registry.catalog.components.empty', 'A Component Catalog must declare at least one component.');
  }
}

function assertCapabilityCatalog(manifest: CapabilityCatalogManifest): void {
  assertRecord(manifest, 'Capability Catalog');
  assertOnlyKeys(manifest, ['capabilities', 'description', 'id', 'schema', 'version'], 'Capability Catalog');
  if (manifest.schema !== 'domily.capability-catalog/v1') {
    throw invalid('registry.capability-catalog.schema.invalid', 'Capability Catalog schema must be "domily.capability-catalog/v1".');
  }
  assertManifestIdentity(manifest.id, manifest.version, 'Capability Catalog');
  assertOptionalString(manifest.description, 'Capability Catalog description');
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw invalid('registry.capability-catalog.capabilities.empty', 'A Capability Catalog must declare at least one capability.');
  }
}

function assertComponentManifest(component: ComponentManifest, name: string): void {
  assertRecord(component, `Component "${name}"`);
  assertOnlyKeys(component, ['bindings', 'children', 'description', 'events', 'examples', 'props', 'slots', 'styleForwarding'], `Component "${name}"`);
  assertRequiredDescription(component.description, `Component "${name}"`);
  assertJsonSchemaDefinition(component.props, `Component "${name}" props`);
  assertSlotManifest(component.children, `Component "${name}" children`);
  assertSlotMap(component.slots, `Component "${name}" slots`);
  assertBindingMap(component.bindings, component.events, `Component "${name}" bindings`);
  assertEventMap(component.events, `Component "${name}" events`);
  assertStyleForwarding(component.styleForwarding, `Component "${name}" styleForwarding`);
}

function assertCapabilityManifest(manifest: CapabilityManifest): void {
  assertRecord(manifest, `Capability "${String(manifest?.id ?? '')}"`);
  assertOnlyKeys(manifest, ['description', 'examples', 'id', 'input', 'invocation', 'output', 'version'], `Capability "${String(manifest.id ?? '')}"`);
  assertManifestIdentity(manifest.id, manifest.version, 'Capability');
  assertRequiredDescription(manifest.description, `Capability "${manifest.id}"`);
  assertJsonSchemaDefinition(manifest.input, `Capability "${manifest.id}" input`);
  assertJsonSchemaDefinition(manifest.output, `Capability "${manifest.id}" output`);
  assertRecord(manifest.invocation, `Capability "${manifest.id}" invocation`);
  assertOnlyKeys(manifest.invocation, ['localPage', 'remotePage'], `Capability "${manifest.id}" invocation`);
  if (typeof manifest.invocation.localPage !== 'boolean' || typeof manifest.invocation.remotePage !== 'boolean') {
    throw invalid('registry.capability.invocation.invalid', `Capability "${manifest.id}" must declare boolean localPage and remotePage permissions.`);
  }
}

function assertExtensionManifest(manifest: ExtensionManifest): void {
  assertRecord(manifest, 'Extension');
  assertOnlyKeys(manifest, ['config', 'delivery', 'description', 'id', 'requires', 'schema', 'scopes', 'version'], 'Extension');
  if (manifest.schema !== 'domily.extension/v1') {
    throw invalid('registry.extension.schema.invalid', 'Extension schema must be "domily.extension/v1".');
  }
  assertManifestIdentity(manifest.id, manifest.version, 'Extension');
  assertRequiredDescription(manifest.description, `Extension "${manifest.id}"`);
  assertDelivery(manifest.delivery, `Extension "${manifest.id}" delivery`);
  assertJsonSchemaDefinition(manifest.config, `Extension "${manifest.id}" config`, true);
  assertScopeList(manifest.scopes, `Extension "${manifest.id}" scopes`);
  if (manifest.requires !== undefined) {
    assertRecord(manifest.requires, `Extension "${manifest.id}" requires`);
    assertOnlyKeys(manifest.requires, ['capabilities', 'catalogs'], `Extension "${manifest.id}" requires`);
    assertRequirementList(manifest.requires.catalogs, `Extension "${manifest.id}" catalog requirements`);
    assertRequirementList(manifest.requires.capabilities, `Extension "${manifest.id}" capability requirements`);
  }
}

function assertScopeList(scopes: readonly ScopeManifest[] | undefined, label: string): void {
  if (scopes === undefined) {
    return;
  }
  if (!Array.isArray(scopes)) {
    throw invalid('registry.scope.list.invalid', `${label} must be an array.`);
  }
  const names = new Set<string>();
  for (const input of scopes as readonly unknown[]) {
    assertRecord(input, `${label} scope`);
    assertOnlyKeys(input, ['mode', 'name', 'value'], `${label} scope`);
    const scope = input as unknown as ScopeManifest;
    assertScope(scope.name);
    if (scope.mode !== 'read' && scope.mode !== 'readwrite') {
      throw invalid('registry.scope.mode.invalid', `${label} scope "${scope.name}" must use read or readwrite mode.`);
    }
    if (names.has(scope.name)) {
      throw invalid('registry.scope.duplicate', `${label} declares scope "${scope.name}" more than once.`);
    }
    names.add(scope.name);
    assertJsonSchemaDefinition(scope.value, `${label} scope "${scope.name}" value`);
  }
}

function assertSlotManifest(slot: unknown, label: string): void {
  if (slot === undefined) {
    return;
  }
  assertRecord(slot, label);
  assertOnlyKeys(slot, ['maxItems', 'minItems'], label);
  assertOptionalNonNegativeInteger(slot.minItems, `${label} minItems`);
  assertOptionalNonNegativeInteger(slot.maxItems, `${label} maxItems`);
  if (typeof slot.minItems === 'number' && typeof slot.maxItems === 'number' && slot.minItems > slot.maxItems) {
    throw invalid('registry.slot.range.invalid', `${label} minItems cannot exceed maxItems.`);
  }
}

function assertSlotMap(slots: unknown, label: string): void {
  if (slots === undefined) {
    return;
  }
  assertRecord(slots, label);
  for (const [name, slot] of Object.entries(slots)) {
    assertComponentName(name);
    assertSlotManifest(slot, `${label}.${name}`);
  }
}

function assertBindingMap(bindings: unknown, events: unknown, label: string): void {
  if (bindings === undefined) {
    return;
  }
  assertRecord(bindings, label);
  for (const [name, binding] of Object.entries(bindings)) {
    assertComponentName(name);
    assertRecord(binding, `${label}.${name}`);
    assertOnlyKeys(binding, ['mode', 'value', 'write'], `${label}.${name}`);
    if (binding.mode !== 'read' && binding.mode !== 'readwrite') {
      throw invalid('registry.binding.mode.invalid', `${label}.${name} must use read or readwrite mode.`);
    }
    assertJsonSchemaDefinition(binding.value, `${label}.${name} value`);
    if (binding.mode === 'readwrite' && binding.write === undefined) {
      throw invalid('registry.binding.write.required', `${label}.${name} requires a write event and value path.`);
    }
    if (binding.write !== undefined) {
      assertRecord(binding.write, `${label}.${name} write`);
      assertOnlyKeys(binding.write, ['event', 'valuePath'], `${label}.${name} write`);
      if (typeof binding.write.event !== 'string' || !isEventName(binding.write.event)) {
        throw invalid('registry.binding.write.event.invalid', `${label}.${name} write event is invalid.`);
      }
      if (!isSafeValuePath(binding.write.valuePath)) {
        throw invalid('registry.binding.write.path.invalid', `${label}.${name} write valuePath is invalid.`);
      }
      if (!isRecord(events) || !Object.hasOwn(events, binding.write.event)) {
        throw invalid('registry.binding.write.event.unknown', `${label}.${name} write event must be declared by the component.`);
      }
    }
  }
}

function assertEventMap(events: unknown, label: string): void {
  if (events === undefined) {
    return;
  }
  assertRecord(events, label);
  for (const [name, event] of Object.entries(events)) {
    assertComponentName(name);
    assertRecord(event, `${label}.${name}`);
    assertOnlyKeys(event, ['description', 'payload'], `${label}.${name}`);
    assertOptionalString(event.description, `${label}.${name} description`);
    assertJsonSchemaDefinition(event.payload, `${label}.${name} payload`);
  }
}

function assertStyleForwarding(value: unknown, label: string): void {
  if (value === undefined) {
    return;
  }
  assertRecord(value, label);
  assertOnlyKeys(value, ['className', 'style'], label);
  if (value.className !== undefined && typeof value.className !== 'boolean') {
    throw invalid('registry.style-forwarding.invalid', `${label}.className must be a boolean.`);
  }
  if (value.style !== undefined && typeof value.style !== 'boolean') {
    throw invalid('registry.style-forwarding.invalid', `${label}.style must be a boolean.`);
  }
}

function assertRequirementList(value: unknown, label: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw invalid('registry.requirement.list.invalid', `${label} must be an array.`);
  }
  for (const requirement of value) {
    assertRecord(requirement, `${label} entry`);
    assertOnlyKeys(requirement, ['id', 'range'], `${label} entry`);
    if (typeof requirement.id !== 'string' || !isIdentifier(requirement.id)) {
      throw invalid('registry.requirement.id.invalid', `${label} entries require a valid id.`);
    }
    if (requirement.range !== undefined && (typeof requirement.range !== 'string' || !isSupportedVersionRange(requirement.range))) {
      throw invalid('registry.requirement.range.invalid', `${label} entries require a supported version range.`);
    }
  }
}

function assertJsonSchemaDefinition(schema: unknown, label: string, required = false): void {
  if (schema === undefined) {
    if (required) {
      throw invalid('registry.schema.required', `${label} is required.`);
    }
    return;
  }
  assertRecord(schema, label);
  assertOnlyKeys(schema, ['additionalProperties', 'const', 'enum', 'items', 'maxItems', 'maxLength', 'maximum', 'minItems', 'minLength', 'minimum', 'properties', 'required', 'type'], label);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0 || types.some((type) => typeof type !== 'string' || !schemaTypes.has(type))) {
      throw invalid('registry.schema.type.invalid', `${label} contains an unsupported JSON Schema type.`);
    }
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw invalid('registry.schema.enum.invalid', `${label} enum must be a non-empty array.`);
  }
  if (schema.properties !== undefined) {
    assertRecord(schema.properties, `${label} properties`);
    for (const [name, property] of Object.entries(schema.properties)) {
      if (unsafeKeys.has(name)) {
        throw invalid('registry.schema.key.unsafe', `${label} properties contains unsafe key "${name}".`);
      }
      assertJsonSchemaDefinition(property, `${label} properties.${name}`, true);
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== 'string' || !name)) {
      throw invalid('registry.schema.required.invalid', `${label} required must be an array of non-empty property names.`);
    }
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== true && schema.additionalProperties !== false) {
    assertJsonSchemaDefinition(schema.additionalProperties, `${label} additionalProperties`, true);
  }
  assertJsonSchemaDefinition(schema.items, `${label} items`);
  assertOptionalNonNegativeInteger(schema.minItems, `${label} minItems`);
  assertOptionalNonNegativeInteger(schema.maxItems, `${label} maxItems`);
  assertOptionalNonNegativeInteger(schema.minLength, `${label} minLength`);
  assertOptionalNonNegativeInteger(schema.maxLength, `${label} maxLength`);
  assertOptionalFiniteNumber(schema.minimum, `${label} minimum`);
  assertOptionalFiniteNumber(schema.maximum, `${label} maximum`);
}

function assertDelivery(value: unknown, label: string): void {
  if (value === undefined) {
    return;
  }
  assertRecord(value, label);
  assertOnlyKeys(value, ['remotePage'], label);
  if (typeof value.remotePage !== 'boolean') {
    throw invalid('registry.delivery.invalid', `${label}.remotePage must be a boolean.`);
  }
}

function assertManifestIdentity(id: unknown, version: unknown, kind: string): void {
  if (typeof id !== 'string' || !isIdentifier(id)) {
    throw invalid('registry.manifest.id.invalid', `${kind} id must be a non-empty identifier without whitespace.`);
  }
  if (typeof version !== 'string' || !parseVersion(version)) {
    throw invalid('registry.manifest.version.invalid', `${kind} "${id}" must use an exact x.y.z SemVer version.`);
  }
}

function assertNamespace(namespace: unknown): void {
  if (typeof namespace !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace)) {
    throw invalid('registry.catalog.namespace.invalid', 'Catalog namespace must be a simple identifier.');
  }
}

function assertComponentName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw invalid('registry.component.name.invalid', `Component name "${name}" must be a simple identifier.`);
  }
}

function isEventName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function isSafeValuePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  const segments = value.split('.');
  return segments.every((segment) => /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment) && !unsafeKeys.has(segment));
}

function assertScope(name: unknown): void {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw invalid('registry.scope.name.invalid', `Scope "${String(name)}" must be a simple identifier.`);
  }
}

function assertRequiredDescription(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalid('registry.description.required', `${label} requires a description.`);
  }
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw invalid('registry.string.invalid', `${label} must be a string.`);
  }
}

function assertOptionalNonNegativeInteger(value: unknown, label: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid('registry.number.invalid', `${label} must be a non-negative integer.`);
  }
}

function assertOptionalFiniteNumber(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw invalid('registry.number.invalid', `${label} must be a finite number.`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalid('registry.manifest.object.invalid', `${label} must be a plain object.`);
  }
}

function assertOnlyKeys(value: object, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw invalid('registry.manifest.field.unknown', `${label} cannot contain field "${key}".`);
    }
  }
}

function snapshotManifest<T>(value: T, label: string): T {
  return deepFreeze(cloneJsonCompatible(value, label, '', new WeakSet<object>())) as T;
}

function cloneJsonCompatible(
  value: unknown,
  label: string,
  path: string,
  ancestors: WeakSet<object>,
): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(path)} must be a finite number.`);
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(path)} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw invalid('registry.manifest.json.circular', `${label} contains a circular reference at ${formatPath(path)}.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid('registry.manifest.json.symbol', `${label} ${formatPath(path)} cannot contain symbol keys.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(path)} must use ordinary arrays.`);
      }
      for (const key of Object.keys(value)) {
        if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(path)} cannot contain non-index array properties.`);
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(path)} cannot contain sparse arrays.`);
        }
      }
      return value.map((item, index) => cloneJsonCompatible(item, label, `${path}[${index}]`, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(path)} must use plain objects.`);
    }
    const clone: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw invalid('registry.manifest.json.invalid', `${label} ${formatPath(joinPath(path, key))} cannot use getters, setters, or hidden fields.`);
      }
      if (unsafeKeys.has(key)) {
        throw invalid('registry.manifest.json.unsafe-key', `${label} ${formatPath(joinPath(path, key))} uses an unsafe key.`);
      }
      clone[key] = cloneJsonCompatible(descriptor.value, label, joinPath(path, key), ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
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

function versionSatisfies(version: string, range: string | undefined): boolean {
  if (range === undefined || range === '*') {
    return true;
  }
  const current = parseVersion(version);
  if (!current || !isSupportedVersionRange(range)) {
    return false;
  }
  if (/^\d+\.\d+\.\d+$/.test(range)) {
    return version === range;
  }
  const operator = range[0]!;
  const parts = range.slice(1).split('.').map(Number);
  const lower = { major: parts[0]!, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
  if (compareVersion(current, lower) < 0) {
    return false;
  }
  const upper = operator === '~'
    ? tildeUpperBound(parts)
    : caretUpperBound(parts);
  return compareVersion(current, upper) < 0;
}

function tildeUpperBound(parts: readonly number[]): Version {
  return parts.length === 1
    ? { major: parts[0]! + 1, minor: 0, patch: 0 }
    : { major: parts[0]!, minor: parts[1]! + 1, patch: 0 };
}

function caretUpperBound(parts: readonly number[]): Version {
  const major = parts[0]!;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if (major > 0 || parts.length === 1) {
    return { major: major + 1, minor: 0, patch: 0 };
  }
  if (minor > 0 || parts.length === 2) {
    return { major: 0, minor: minor + 1, patch: 0 };
  }
  return { major: 0, minor: 0, patch: patch + 1 };
}

interface Version {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(value: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersion(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function isIdentifier(value: string): boolean {
  return value.trim().length > 0 && !/\s/.test(value);
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function formatPath(path: string): string {
  return path || '<root>';
}

function invalid(code: string, message: string): PageRegistryError {
  return new PageRegistryError(code, message);
}

function duplicate(kind: string, id: string): PageRegistryError {
  return new PageRegistryError('registry.duplicate', `A ${kind} with id "${id}" is already registered.`);
}
