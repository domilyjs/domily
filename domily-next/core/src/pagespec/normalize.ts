import {
  isSupportedVersionRange,
  validateJsonSchema,
} from '../registry/index.ts';
import type {
  ComponentManifest,
  JsonSchema,
  PageRegistrySnapshot,
  RegisteredExtension,
  ScopeManifest,
  SlotManifest,
} from '../registry/types.ts';
import type {
  CapabilityInvocation,
  JsonValue,
  NormalizedPageRequirements,
  NormalizedPageSpec,
  PageSpecIssue,
  PageSpecResult,
  Requirement,
  UiNode,
} from './types.ts';
import { isBindingCandidate, parseBindingPath } from './binding.ts';

const pageKeys = new Set(['extensions', 'id', 'lifecycle', 'requires', 'schema', 'ui']);
const requirementGroupKeys = new Set(['capabilities', 'catalogs', 'extensions']);
const requirementKeys = new Set(['id', 'range']);
const uiNodeKeys = new Set(['bind', 'children', 'on', 'props', 'slots', 'type']);
const invocationKeys = new Set(['args', 'capability']);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const blockedProps = new Set(['innerhtml', 'outerhtml', 'srcdoc']);

export interface NormalizePageSpecOptions {
  origin?: 'local' | 'remote';
  registry: PageRegistrySnapshot;
  scopes?: readonly ScopeManifest[];
}

/** Raised for cyclic configuration graphs, which cannot be serialized safely. */
export class PageSpecInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageSpecInputError';
  }
}

/**
 * Validates and normalizes a JSON-compatible PageSpec against the local
 * registry. It has no dependency on the legacy AST, runtime, or renderer.
 */
export function normalizePageSpec(value: unknown, options: NormalizePageSpecOptions): PageSpecResult<NormalizedPageSpec> {
  const issues: PageSpecIssue[] = [];
  assertJsonCompatible(value, '');
  if (!isRecord(value)) {
    return failure([issue('pagespec.root.type', 'PageSpec must be an object.', '')]);
  }

  rejectUnknownKeys(value, pageKeys, '', issues);
  const schema = readString(value, 'schema', 'schema', issues);
  if (schema !== 'domily.page/v1') {
    issues.push(issue('pagespec.schema.invalid', 'PageSpec schema must be "domily.page/v1".', 'schema'));
  }
  const id = readString(value, 'id', 'id', issues);
  if (id && !isIdentifier(id)) {
    issues.push(issue('pagespec.id.invalid', 'PageSpec id must be a non-empty identifier without whitespace.', 'id'));
  }

  const requirements = normalizeRequirements(value.requires, options.registry, options.origin ?? 'local', issues);
  const extensionActivation = normalizeExtensions(value.extensions, requirements, options, issues);
  const scopes = activeScopes(options.scopes, extensionActivation.active, issues);
  const lifecycle = normalizeLifecycle(value.lifecycle, requirements, scopes, options, issues);
  const ui = normalizeUiNode(value.ui, 'ui', requirements, scopes, options, issues);

  if (issues.length > 0 || !id || !ui) {
    return failure(issues);
  }

  const normalized: NormalizedPageSpec = {
    schema: 'domily.page/v1',
    id,
    requires: requirements,
    ...(lifecycle ? { lifecycle } : {}),
    ui,
    ...(extensionActivation.config ? { extensions: extensionActivation.config } : {}),
  };
  return { ok: true, value: deepFreeze(normalized), issues: [] };
}

function normalizeRequirements(
  value: unknown,
  registry: PageRegistrySnapshot,
  origin: 'local' | 'remote',
  issues: PageSpecIssue[],
): NormalizedPageRequirements {
  if (value === undefined) {
    return { catalogs: [], capabilities: [], extensions: [] };
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.requires.type', 'requires must be an object.', 'requires'));
    return { catalogs: [], capabilities: [], extensions: [] };
  }

  rejectUnknownKeys(value, requirementGroupKeys, 'requires', issues);

  const catalogs = normalizeRequirementList(value.catalogs, 'requires.catalogs', issues);
  const capabilities = normalizeRequirementList(value.capabilities, 'requires.capabilities', issues);
  const extensions = normalizeRequirementList(value.extensions, 'requires.extensions', issues);

  for (const requirement of catalogs) {
    const catalog = registry.resolveCatalog(requirement);
    if (!catalog) {
      issues.push(issue('pagespec.requirement.catalog.unresolved', `Catalog "${formatRequirement(requirement)}" is not registered or compatible.`, 'requires.catalogs'));
    } else if (origin === 'remote' && catalog.manifest.delivery?.remotePage !== true) {
      issues.push(issue('pagespec.requirement.catalog.remote.disallowed', `Catalog "${requirement.id}" is not available to remote pages.`, 'requires.catalogs'));
    }
  }
  for (const requirement of capabilities) {
    const capability = registry.resolveCapability(requirement);
    if (!capability) {
      issues.push(issue('pagespec.requirement.capability.unresolved', `Capability "${formatRequirement(requirement)}" is not registered or compatible.`, 'requires.capabilities'));
    } else if (origin === 'remote' && !capability.manifest.invocation.remotePage) {
      issues.push(issue('pagespec.requirement.capability.remote.disallowed', `Capability "${requirement.id}" is not available to remote pages.`, 'requires.capabilities'));
    } else if (origin === 'local' && !capability.manifest.invocation.localPage) {
      issues.push(issue('pagespec.requirement.capability.local.disallowed', `Capability "${requirement.id}" is not available to local pages.`, 'requires.capabilities'));
    }
  }
  for (const requirement of extensions) {
    if (!registry.resolveExtension(requirement)) {
      issues.push(issue('pagespec.requirement.extension.unresolved', `Extension "${formatRequirement(requirement)}" is not registered or compatible.`, 'requires.extensions'));
    }
  }

  return { catalogs, capabilities, extensions };
}

function normalizeRequirementList(value: unknown, path: string, issues: PageSpecIssue[]): Requirement[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(issue('pagespec.requirement.list.type', 'Requirement declarations must be arrays.', path));
    return [];
  }
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  value.forEach((input, index) => {
    const requirement = normalizeRequirement(input, `${path}[${index}]`, issues);
    if (!requirement) {
      return;
    }
    if (seen.has(requirement.id)) {
      issues.push(issue('pagespec.requirement.duplicate', `Requirement "${requirement.id}" is declared more than once.`, `${path}[${index}]`));
      return;
    }
    seen.add(requirement.id);
    requirements.push(requirement);
  });
  return requirements;
}

function normalizeRequirement(value: unknown, path: string, issues: PageSpecIssue[]): Requirement | undefined {
  if (typeof value === 'string') {
    return parseRequirementString(value, path, issues);
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.requirement.type', 'A requirement must be an id string or { id, range } object.', path));
    return undefined;
  }
  rejectUnknownKeys(value, requirementKeys, path, issues);
  const id = readString(value, 'id', `${path}.id`, issues);
  const range = readOptionalString(value, 'range', `${path}.range`, issues);
  if (!id || !isIdentifier(id)) {
    issues.push(issue('pagespec.requirement.id.invalid', 'Requirement id must be a non-empty identifier without whitespace.', `${path}.id`));
    return undefined;
  }
  if (range !== undefined && !isSupportedVersionRange(range)) {
    issues.push(issue('pagespec.requirement.range.invalid', `Unsupported version range "${range}".`, `${path}.range`));
    return undefined;
  }
  return range ? { id, range } : { id };
}

function parseRequirementString(value: string, path: string, issues: PageSpecIssue[]): Requirement | undefined {
  const delimiter = value.lastIndexOf('@');
  const hasRange = delimiter > 0;
  const id = hasRange ? value.slice(0, delimiter) : value;
  const range = hasRange ? value.slice(delimiter + 1) : undefined;
  if (!isIdentifier(id)) {
    issues.push(issue('pagespec.requirement.id.invalid', 'Requirement id must be a non-empty identifier without whitespace.', path));
    return undefined;
  }
  if (range !== undefined && (!range || !isSupportedVersionRange(range))) {
    issues.push(issue('pagespec.requirement.range.invalid', `Unsupported version range "${range ?? ''}".`, path));
    return undefined;
  }
  return range ? { id, range } : { id };
}

function normalizeExtensions(
  value: unknown,
  requirements: NormalizedPageRequirements,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
): ExtensionActivation {
  const active: RegisteredExtension[] = [];
  if (value === undefined) {
    for (const requirement of requirements.extensions) {
      issues.push(issue(
        'pagespec.extension.config.missing',
        `Extension "${requirement.id}" must be enabled through extensions.${requirement.id}.`,
        'extensions',
      ));
    }
    return { active };
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.extensions.type', 'extensions must be an object keyed by registered extension id.', 'extensions'));
    return { active };
  }
  const result: Record<string, JsonValue> = {};
  const configured = new Set<string>();
  for (const [id, config] of Object.entries(value)) {
    const path = `extensions.${id}`;
    configured.add(id);
    if (unsafeKeys.has(id)) {
      issues.push(issue('pagespec.extension.id.unsafe', `Extension id "${id}" is not allowed.`, path));
      continue;
    }
    const available = options.registry.resolveExtension({ id });
    if (!available) {
      issues.push(issue('pagespec.extension.unknown', `Extension "${id}" is not registered.`, path));
      continue;
    }
    const requirement = findRequirement(requirements.extensions, id);
    if (!requirement) {
      issues.push(issue('pagespec.extension.not-required', `Extension "${id}" must be declared in requires.extensions.`, path));
      continue;
    }
    const extension = options.registry.resolveExtension(requirement);
    if (!extension) {
      issues.push(issue('pagespec.extension.incompatible', `Extension "${id}" does not satisfy its declared version range.`, path));
      continue;
    }
    const issueCount = issues.length;
    validateExtensionRequirements(
      extension.manifest,
      requirements,
      options.registry,
      options.origin ?? 'local',
      path,
      issues,
    );
    if (options.origin === 'remote' && extension.manifest.delivery?.remotePage !== true) {
      issues.push(issue('pagespec.extension.remote.disallowed', `Extension "${id}" is not available to remote pages.`, path));
    }
    const schemaIssues = validateJsonSchema(config as JsonValue, extension.manifest.config, path);
    issues.push(...schemaIssues);
    result[id] = cloneJson(config as JsonValue);
    if (issues.length === issueCount) {
      active.push(extension);
    }
  }
  for (const requirement of requirements.extensions) {
    if (!configured.has(requirement.id)) {
      issues.push(issue(
        'pagespec.extension.config.missing',
        `Extension "${requirement.id}" must be enabled through extensions.${requirement.id}.`,
        'extensions',
      ));
    }
  }
  return { active, config: result };
}

function validateExtensionRequirements(
  extension: RegisteredExtension['manifest'],
  requirements: NormalizedPageRequirements,
  registry: PageRegistrySnapshot,
  origin: 'local' | 'remote',
  path: string,
  issues: PageSpecIssue[],
): void {
  for (const requirement of extension.requires?.catalogs ?? []) {
    const pageRequirement = findRequirement(requirements.catalogs, requirement.id);
    if (!pageRequirement) {
      issues.push(issue(
        'pagespec.extension.catalog.not-required',
        `Extension "${extension.id}" requires Catalog "${formatRequirement(requirement)}" to be declared.`,
        path,
      ));
      continue;
    }
    const catalog = registry.resolveCatalog(requirement);
    if (!catalog) {
      issues.push(issue(
        'pagespec.extension.catalog.incompatible',
        `Extension "${extension.id}" requires compatible Catalog "${formatRequirement(requirement)}".`,
        path,
      ));
    } else if (origin === 'remote' && catalog.manifest.delivery?.remotePage !== true) {
      issues.push(issue(
        'pagespec.extension.catalog.remote.disallowed',
        `Extension "${extension.id}" cannot use Catalog "${requirement.id}" from a remote page.`,
        path,
      ));
    }
  }
  for (const requirement of extension.requires?.capabilities ?? []) {
    const pageRequirement = findRequirement(requirements.capabilities, requirement.id);
    if (!pageRequirement) {
      issues.push(issue(
        'pagespec.extension.capability.not-required',
        `Extension "${extension.id}" requires Capability "${formatRequirement(requirement)}" to be declared.`,
        path,
      ));
      continue;
    }
    const capability = registry.resolveCapability(requirement);
    if (!capability) {
      issues.push(issue(
        'pagespec.extension.capability.incompatible',
        `Extension "${extension.id}" requires compatible Capability "${formatRequirement(requirement)}".`,
        path,
      ));
    } else if (origin === 'remote' && !capability.manifest.invocation.remotePage) {
      issues.push(issue(
        'pagespec.extension.capability.remote.disallowed',
        `Extension "${extension.id}" cannot use Capability "${requirement.id}" from a remote page.`,
        path,
      ));
    } else if (origin === 'local' && !capability.manifest.invocation.localPage) {
      issues.push(issue(
        'pagespec.extension.capability.local.disallowed',
        `Extension "${extension.id}" cannot use Capability "${requirement.id}" from a local page.`,
        path,
      ));
    }
  }
}

function activeScopes(
  supplied: readonly ScopeManifest[] | undefined,
  activeExtensions: readonly RegisteredExtension[],
  issues: PageSpecIssue[],
): Map<string, ScopeManifest> {
  const scopes = new Map<string, ScopeManifest>();
  for (const extension of activeExtensions) {
    for (const scope of extension.manifest.scopes ?? []) {
      addScope(scopes, scope, extension.manifest.id, issues);
    }
  }
  for (const scope of supplied ?? []) {
    if (scopes.has(scope.name)) {
      issues.push(issue(
        'pagespec.scope.extension.shadowed',
        `Host scope "${scope.name}" cannot shadow an active extension scope.`,
        'requires',
      ));
      continue;
    }
    addScope(scopes, scope, 'host', issues);
  }
  return scopes;
}

interface ExtensionActivation {
  active: readonly RegisteredExtension[];
  config?: Record<string, JsonValue>;
}

function addScope(
  scopes: Map<string, ScopeManifest>,
  scope: ScopeManifest,
  owner: string,
  issues: PageSpecIssue[],
): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(scope.name) || unsafeKeys.has(scope.name)) {
    issues.push(issue('pagespec.scope.name.invalid', `Scope "${scope.name}" from ${owner} is invalid.`, 'requires'));
    return;
  }
  if (scopes.has(scope.name)) {
    issues.push(issue('pagespec.scope.duplicate', `Scope "${scope.name}" is provided more than once.`, 'requires'));
    return;
  }
  scopes.set(scope.name, scope);
}

function normalizeLifecycle(
  value: unknown,
  requirements: NormalizedPageRequirements,
  scopes: Map<string, ScopeManifest>,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
): NormalizedPageSpec['lifecycle'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.lifecycle.type', 'lifecycle must be an object.', 'lifecycle'));
    return undefined;
  }
  const result: NonNullable<NormalizedPageSpec['lifecycle']> = {};
  for (const [event, invocation] of Object.entries(value)) {
    if (event !== 'mounted' && event !== 'unmounted') {
      issues.push(issue('pagespec.lifecycle.event.unknown', `Lifecycle event "${event}" is not supported by PageSpec core.`, `lifecycle.${event}`));
      continue;
    }
    const normalized = normalizeInvocation(invocation, `lifecycle.${event}`, requirements, scopes, options, issues, false);
    if (normalized) {
      result[event] = normalized;
    }
  }
  return result;
}

function normalizeUiNode(
  value: unknown,
  path: string,
  requirements: NormalizedPageRequirements,
  scopes: Map<string, ScopeManifest>,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
): UiNode | undefined {
  if (!isRecord(value)) {
    issues.push(issue('pagespec.ui.type', 'A UI node must be an object.', path));
    return undefined;
  }
  rejectUnknownKeys(value, uiNodeKeys, path, issues);
  const type = readString(value, 'type', `${path}.type`, issues);
  if (!type || !/^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z][A-Za-z0-9_-]*$/.test(type)) {
    issues.push(issue('pagespec.ui.component.invalid', 'Component type must use namespace.component form.', `${path}.type`));
    return undefined;
  }
  const resolved = options.registry.resolveComponent(type);
  if (!resolved) {
    issues.push(issue('pagespec.ui.component.unknown', `Component "${type}" is not registered.`, `${path}.type`));
    return undefined;
  }
  const catalogRequirement = findRequirement(requirements.catalogs, resolved.catalog.id);
  if (!catalogRequirement) {
    issues.push(issue('pagespec.component.catalog-not-required', `Component "${type}" requires Catalog "${resolved.catalog.id}" to be declared.`, `${path}.type`));
  } else if (!options.registry.resolveCatalog(catalogRequirement)) {
    issues.push(issue('pagespec.component.catalog-incompatible', `Catalog "${formatRequirement(catalogRequirement)}" does not satisfy component "${type}".`, `${path}.type`));
  }
  if (options.origin === 'remote' && resolved.catalog.delivery?.remotePage !== true) {
    issues.push(issue('pagespec.component.remote.disallowed', `Component "${type}" is not available to remote pages.`, `${path}.type`));
  }

  rejectPropsBindingConflicts(value.props, value.bind, path, issues);
  validateRequiredProps(value.props, value.bind, resolved.component, path, issues);
  const props = normalizeProps(value.props, `${path}.props`, resolved.component, scopes, issues);
  const bind = normalizeBindings(value.bind, `${path}.bind`, resolved.component, scopes, issues);
  const on = normalizeEvents(value.on, `${path}.on`, resolved.component, requirements, scopes, options, issues);
  const children = normalizeChildren(
    value.children,
    `${path}.children`,
    resolved.component.children,
    requirements,
    scopes,
    options,
    issues,
  );
  const slots = normalizeSlots(value.slots, `${path}.slots`, resolved.component, requirements, scopes, options, issues);

  return {
    type,
    ...(props && Object.keys(props).length > 0 ? { props } : {}),
    ...(bind && Object.keys(bind).length > 0 ? { bind } : {}),
    ...(on && Object.keys(on).length > 0 ? { on } : {}),
    ...(children && children.length > 0 ? { children } : {}),
    ...(slots && Object.keys(slots).length > 0 ? { slots } : {}),
  };
}

function rejectPropsBindingConflicts(
  props: unknown,
  bindings: unknown,
  path: string,
  issues: PageSpecIssue[],
): void {
  if (!isRecord(props) || !isRecord(bindings)) {
    return;
  }
  for (const name of Object.keys(bindings)) {
    if (Object.hasOwn(props, name)) {
      issues.push(issue(
        'pagespec.binding.prop.conflict',
        `Property "${name}" cannot be configured by both props and bind.`,
        `${path}.bind.${name}`,
      ));
    }
  }
}

function normalizeProps(
  value: unknown,
  path: string,
  component: ComponentManifest,
  scopes: Map<string, ScopeManifest>,
  issues: PageSpecIssue[],
): Record<string, JsonValue> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.props.type', 'props must be an object.', path));
    return undefined;
  }
  const result: Record<string, JsonValue> = {};
  for (const [name, propValue] of Object.entries(value)) {
    const propPath = `${path}.${name}`;
    if (isDangerousProp(name)) {
      issues.push(issue('pagespec.prop.disallowed', `Property "${name}" is not allowed.`, propPath));
      continue;
    }
    const binding = isBindingCandidate(propValue) ? propValue : undefined;
    if (binding) {
      const bindingManifest = ownMapValue(component.bindings, name);
      if (!bindingManifest) {
        issues.push(issue('pagespec.binding.prop.disallowed', `Property "${name}" does not allow a binding.`, propPath));
      }
      const sourceSchema = validateBinding(binding, propPath, scopes, 'read', issues);
      validateBindingValueSchema(sourceSchema, bindingManifest?.value, propPath, issues);
      result[name] = binding;
      continue;
    }
    const schema = propertySchema(component, name);
    if (!schema) {
      issues.push(issue('pagespec.prop.unknown', `Property "${name}" is not declared by this component.`, propPath));
      continue;
    }
    issues.push(...validateJsonSchema(propValue as JsonValue, schema, propPath));
    result[name] = cloneTemplate(propValue as JsonValue);
  }
  return result;
}

function validateRequiredProps(
  props: unknown,
  bindings: unknown,
  component: ComponentManifest,
  path: string,
  issues: PageSpecIssue[],
): void {
  const propRecord = isRecord(props) ? props : undefined;
  const bindingRecord = isRecord(bindings) ? bindings : undefined;
  for (const name of component.props?.required ?? []) {
    if (propRecord && Object.hasOwn(propRecord, name)) {
      continue;
    }
    if (bindingRecord && Object.hasOwn(bindingRecord, name)) {
      continue;
    }
    issues.push(issue('pagespec.prop.required', `Property "${name}" is required.`, `${path}.props.${name}`));
  }
}

function normalizeBindings(
  value: unknown,
  path: string,
  component: ComponentManifest,
  scopes: Map<string, ScopeManifest>,
  issues: PageSpecIssue[],
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.binding.type', 'bind must be an object.', path));
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [name, binding] of Object.entries(value)) {
    const bindingPath = `${path}.${name}`;
    if (typeof binding !== 'string') {
      issues.push(issue('pagespec.binding.value.type', 'A bind value must be a binding path string.', bindingPath));
      continue;
    }
    const manifest = ownMapValue(component.bindings, name);
    if (!manifest) {
      issues.push(issue('pagespec.binding.prop.unknown', `Property "${name}" does not support binding.`, bindingPath));
      continue;
    }
    if (manifest.mode !== 'readwrite') {
      issues.push(issue('pagespec.binding.mode.invalid', `Property "${name}" does not support two-way binding.`, bindingPath));
      continue;
    }
    const sourceSchema = validateBinding(binding, bindingPath, scopes, 'readwrite', issues);
    validateBindingValueSchema(sourceSchema, manifest.value, bindingPath, issues);
    result[name] = binding;
  }
  return result;
}

function normalizeEvents(
  value: unknown,
  path: string,
  component: ComponentManifest,
  requirements: NormalizedPageRequirements,
  scopes: Map<string, ScopeManifest>,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
): Record<string, CapabilityInvocation> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.event.type', 'on must be an object.', path));
    return undefined;
  }
  const result: Record<string, CapabilityInvocation> = {};
  for (const [event, invocation] of Object.entries(value)) {
    const eventPath = `${path}.${event}`;
    const eventManifest = ownMapValue(component.events, event);
    if (!eventManifest) {
      issues.push(issue('pagespec.event.unknown', `Event "${event}" is not declared by this component.`, eventPath));
      continue;
    }
    const eventScopes = new Map(scopes);
    eventScopes.set('event', {
      name: 'event',
      mode: 'read',
      ...(eventManifest.payload ? { value: eventManifest.payload } : {}),
    });
    const normalized = normalizeInvocation(invocation, eventPath, requirements, eventScopes, options, issues, true);
    if (normalized) {
      result[event] = normalized;
    }
  }
  return result;
}

function normalizeChildren(
  value: unknown,
  path: string,
  manifest: SlotManifest | undefined,
  requirements: NormalizedPageRequirements,
  scopes: Map<string, ScopeManifest>,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
): UiNode[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(issue('pagespec.children.type', 'children must be an array.', path));
    return undefined;
  }
  if (!manifest && value.length > 0) {
    issues.push(issue('pagespec.children.disallowed', 'This component does not accept children.', path));
  }
  validateSlotCardinality(value.length, manifest, path, issues);
  return value
    .map((child, index) => normalizeUiNode(child, `${path}[${index}]`, requirements, scopes, options, issues))
    .filter((child): child is UiNode => child !== undefined);
}

function normalizeSlots(
  value: unknown,
  path: string,
  component: ComponentManifest,
  requirements: NormalizedPageRequirements,
  scopes: Map<string, ScopeManifest>,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
): Record<string, UiNode | UiNode[]> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(issue('pagespec.slot.type', 'slots must be an object.', path));
    return undefined;
  }
  const result: Record<string, UiNode | UiNode[]> = {};
  for (const [name, slotValue] of Object.entries(value)) {
    const slotPath = `${path}.${name}`;
    const manifest = ownMapValue(component.slots, name);
    if (!manifest) {
      issues.push(issue('pagespec.slot.unknown', `Slot "${name}" is not declared by this component.`, slotPath));
      continue;
    }
    const values = Array.isArray(slotValue) ? slotValue : [slotValue];
    validateSlotCardinality(values.length, manifest, slotPath, issues);
    const nodes = values
      .map((node, index) => normalizeUiNode(node, `${slotPath}[${index}]`, requirements, scopes, options, issues))
      .filter((node): node is UiNode => node !== undefined);
    result[name] = Array.isArray(slotValue) ? nodes : (nodes[0] ?? { type: 'invalid.Node' });
  }
  return result;
}

function normalizeInvocation(
  value: unknown,
  path: string,
  requirements: NormalizedPageRequirements,
  scopes: Map<string, ScopeManifest>,
  options: NormalizePageSpecOptions,
  issues: PageSpecIssue[],
  allowsEventScope: boolean,
): CapabilityInvocation | undefined {
  if (!isRecord(value)) {
    issues.push(issue('pagespec.capability.invocation.type', 'An invocation must be an object.', path));
    return undefined;
  }
  rejectUnknownKeys(value, invocationKeys, path, issues);
  const capability = readString(value, 'capability', `${path}.capability`, issues);
  if (!capability || !isIdentifier(capability)) {
    issues.push(issue('pagespec.capability.id.invalid', 'Capability id must be a non-empty identifier without whitespace.', `${path}.capability`));
    return undefined;
  }
  const requirement = findRequirement(requirements.capabilities, capability);
  if (!requirement) {
    issues.push(issue('pagespec.capability.not-required', `Capability "${capability}" must be declared in requires.capabilities.`, `${path}.capability`));
  }
  const registered = options.registry.resolveCapability(requirement ?? { id: capability });
  if (!registered) {
    issues.push(issue('pagespec.capability.unknown', `Capability "${capability}" is not registered or compatible.`, `${path}.capability`));
  } else if ((options.origin ?? 'local') === 'remote' && !registered.manifest.invocation.remotePage) {
    issues.push(issue('pagespec.capability.remote.disallowed', `Capability "${capability}" is not available to remote pages.`, `${path}.capability`));
  } else if ((options.origin ?? 'local') === 'local' && !registered.manifest.invocation.localPage) {
    issues.push(issue('pagespec.capability.local.disallowed', `Capability "${capability}" is not available to local pages.`, `${path}.capability`));
  }

  let args: JsonValue | undefined;
  if (value.args !== undefined) {
    validateTemplateAgainstSchema(
      value.args as JsonValue,
      registered?.manifest.input,
      `${path}.args`,
      scopes,
      allowsEventScope,
      issues,
    );
    args = cloneTemplate(value.args as JsonValue);
  } else if (registered?.manifest.input) {
    issues.push(issue(
      'pagespec.capability.args.required',
      `Capability "${capability}" requires an args value that matches its input schema.`,
      `${path}.args`,
    ));
  }
  return args === undefined ? { capability } : { capability, args };
}

function validateTemplateAgainstSchema(
  value: JsonValue,
  schema: JsonSchema | undefined,
  path: string,
  scopes: Map<string, ScopeManifest>,
  allowsEventScope: boolean,
  issues: PageSpecIssue[],
): void {
  const binding = isBindingCandidate(value) ? value : undefined;
  if (binding) {
    if (!allowsEventScope && binding.startsWith('$event.')) {
      issues.push(issue('pagespec.binding.event.unavailable', '$event is only available from a component event invocation.', path));
      return;
    }
    const sourceSchema = validateBinding(binding, path, scopes, 'read', issues);
    validateBindingValueSchema(sourceSchema, schema, path, issues);
    return;
  }
  if (Array.isArray(value)) {
    validateTemplateArray(value, schema, path, scopes, allowsEventScope, issues);
    return;
  }
  if (isRecord(value)) {
    validateTemplateObject(value, schema, path, scopes, allowsEventScope, issues);
    return;
  }
  issues.push(...validateJsonSchema(value, schema, path));
}

function validateTemplateArray(
  value: JsonValue[],
  schema: JsonSchema | undefined,
  path: string,
  scopes: Map<string, ScopeManifest>,
  allowsEventScope: boolean,
  issues: PageSpecIssue[],
): void {
  if (schema && !schemaAllowsType(schema, 'array')) {
    issues.push(issue('pagespec.schema.type', 'Expected a non-array value.', path));
    return;
  }
  if (schema?.minItems !== undefined && value.length < schema.minItems) {
    issues.push(issue('pagespec.schema.min-items', `Array must contain at least ${schema.minItems} items.`, path));
  }
  if (schema?.maxItems !== undefined && value.length > schema.maxItems) {
    issues.push(issue('pagespec.schema.max-items', `Array must contain at most ${schema.maxItems} items.`, path));
  }
  value.forEach((item, index) => validateTemplateAgainstSchema(item, schema?.items, `${path}[${index}]`, scopes, allowsEventScope, issues));
}

function validateTemplateObject(
  value: Record<string, JsonValue>,
  schema: JsonSchema | undefined,
  path: string,
  scopes: Map<string, ScopeManifest>,
  allowsEventScope: boolean,
  issues: PageSpecIssue[],
): void {
  if (schema && !schemaAllowsType(schema, 'object')) {
    issues.push(issue('pagespec.schema.type', 'Expected a non-object value.', path));
    return;
  }
  for (const required of schema?.required ?? []) {
    if (!Object.hasOwn(value, required)) {
      issues.push(issue('pagespec.schema.required', `Property "${required}" is required.`, `${path}.${required}`));
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const propertySchema = ownMapValue(schema?.properties, key);
    if (!propertySchema && schema?.additionalProperties === false) {
      issues.push(issue('pagespec.schema.property.unknown', `Property "${key}" is not allowed.`, `${path}.${key}`));
      continue;
    }
    const fallback = typeof schema?.additionalProperties === 'object' ? schema.additionalProperties : undefined;
    validateTemplateAgainstSchema(item, propertySchema ?? fallback, `${path}.${key}`, scopes, allowsEventScope, issues);
  }
}

function validateBinding(
  value: string,
  path: string,
  scopes: Map<string, ScopeManifest>,
  mode: ScopeManifest['mode'],
  issues: PageSpecIssue[],
): JsonSchema | undefined {
  const parsed = parseBindingPath(value);
  if (!parsed) {
    issues.push(issue('pagespec.binding.path.invalid', `Binding "${value}" is not a safe $scope.path reference.`, path));
    return undefined;
  }
  const scope = scopes.get(parsed.scope);
  if (!scope) {
    issues.push(issue('pagespec.binding.scope.unknown', `Scope "$${parsed.scope}" is not available here.`, path));
    return undefined;
  }
  if (mode === 'readwrite' && scope.mode !== 'readwrite') {
    issues.push(issue('pagespec.binding.scope.readonly', `Scope "$${parsed.scope}" does not support two-way binding.`, path));
  }
  const resolved = resolveSchemaPath(scope.value, parsed.segments);
  if (scope.value && !resolved) {
    issues.push(issue('pagespec.binding.path.unknown', `Binding "${value}" is not declared by scope "$${parsed.scope}".`, path));
  }
  return resolved?.schema;
}

function validateBindingValueSchema(
  source: JsonSchema | undefined,
  target: JsonSchema | undefined,
  path: string,
  issues: PageSpecIssue[],
): void {
  if (source && target && !schemasMayOverlap(source, target)) {
    issues.push(issue('pagespec.binding.value.incompatible', 'Binding value is incompatible with the component contract.', path));
  }
}

function resolveSchemaPath(
  schema: JsonSchema | undefined,
  segments: readonly string[],
): { schema?: JsonSchema } | undefined {
  if (!schema) {
    return {};
  }
  let current: JsonSchema | undefined = schema;
  for (const segment of segments) {
    if (!current || !schemaAllowsType(current, 'object')) {
      return undefined;
    }
    const property: JsonSchema | undefined = ownMapValue(current.properties, segment);
    if (property) {
      current = property;
      continue;
    }
    if (current.additionalProperties === false) {
      return undefined;
    }
    if (typeof current.additionalProperties === 'object') {
      current = current.additionalProperties;
      continue;
    }
    return {};
  }
  return current ? { schema: current } : {};
}

function schemasMayOverlap(left: JsonSchema, right: JsonSchema): boolean {
  const leftTypes = schemaTypes(left);
  const rightTypes = schemaTypes(right);
  return leftTypes.some((type) => rightTypes.includes(type));
}

function schemaAllowsType(schema: JsonSchema, type: string): boolean {
  return schemaTypes(schema).includes(type);
}

function schemaTypes(schema: JsonSchema): string[] {
  if (schema.type === undefined) {
    return ['array', 'boolean', 'null', 'number', 'object', 'string'];
  }
  return typeof schema.type === 'string' ? [schema.type] : [...schema.type];
}

function propertySchema(component: ComponentManifest, name: string) {
  const props = component.props;
  if (!props) {
    return undefined;
  }
  const property = ownMapValue(props.properties, name);
  if (property) {
    return property;
  }
  if (props.additionalProperties === true) {
    return {};
  }
  return typeof props.additionalProperties === 'object' ? props.additionalProperties : undefined;
}

function validateSlotCardinality(length: number, slot: SlotManifest | undefined, path: string, issues: PageSpecIssue[]): void {
  if (slot?.minItems !== undefined && length < slot.minItems) {
    issues.push(issue('pagespec.slot.min-items', `Slot requires at least ${slot.minItems} nodes.`, path));
  }
  if (slot?.maxItems !== undefined && length > slot.maxItems) {
    issues.push(issue('pagespec.slot.max-items', `Slot allows at most ${slot.maxItems} nodes.`, path));
  }
}

function findRequirement(requirements: readonly Requirement[], id: string): Requirement | undefined {
  return requirements.find((requirement) => requirement.id === id);
}

function cloneTemplate(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneTemplate);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneTemplate(item)]));
  }
  return value;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function isDangerousProp(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith('on') || blockedProps.has(normalized);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: PageSpecIssue[]): void {
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key) || !allowed.has(key)) {
      const location = path ? `${path}.${key}` : key;
      issues.push(issue('pagespec.field.unknown', `Field "${key}" is not allowed.`, location));
    }
  }
}

function readString(value: Record<string, unknown>, key: string, path: string, issues: PageSpecIssue[]): string | undefined {
  const field = value[key];
  if (typeof field !== 'string' || !field) {
    issues.push(issue('pagespec.field.string.required', `Field "${key}" must be a non-empty string.`, path));
    return undefined;
  }
  return field;
}

function readOptionalString(value: Record<string, unknown>, key: string, path: string, issues: PageSpecIssue[]): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'string') {
    issues.push(issue('pagespec.field.string.type', `Field "${key}" must be a string.`, path));
    return undefined;
  }
  return field;
}

function assertJsonCompatible(value: unknown, path: string, ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new PageSpecInputError(`PageSpec value at ${printPath(path)} must be a finite number.`);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    throw new PageSpecInputError(`PageSpec value at ${printPath(path)} is not JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw new PageSpecInputError(`PageSpec contains a circular reference at ${printPath(path)}.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new PageSpecInputError(`PageSpec value at ${printPath(path)} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new PageSpecInputError(`PageSpec value at ${printPath(path)} cannot use symbol keys.`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonCompatible(item, `${path}[${index}]`, ancestors));
  } else {
    for (const key of Object.keys(value)) {
      if (unsafeKeys.has(key)) {
        throw new PageSpecInputError(`PageSpec value at ${printPath(joinPath(path, key))} uses an unsafe key.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new PageSpecInputError(`PageSpec value at ${printPath(joinPath(path, key))} cannot use getters or setters.`);
      }
      assertJsonCompatible(descriptor.value, joinPath(path, key), ancestors);
    }
  }
  ancestors.delete(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function ownMapValue<T>(
  map: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return map && Object.hasOwn(map, key) ? map[key] : undefined;
}

function isIdentifier(value: string): boolean {
  return value.trim().length > 0 && !/\s/.test(value);
}

function formatRequirement(requirement: Requirement): string {
  return requirement.range ? `${requirement.id}@${requirement.range}` : requirement.id;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function printPath(path: string): string {
  return path || '<root>';
}

function issue(code: string, message: string, path: string): PageSpecIssue {
  return { code, message, path };
}

function failure(issues: PageSpecIssue[]): PageSpecResult<never> {
  return { ok: false, issues };
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
