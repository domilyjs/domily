import { cloneDomJson } from '../dom/value.ts';
import type { JsonValue } from '../pagespec/types.ts';
import type { ScopeManifest } from '../registry/types.ts';
import type {
  PageExtensionRuntimeRegistry,
  RegisteredPageExtensionRuntime,
  TrustedPageExtensionRuntime,
} from './types.ts';

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export class PageExtensionRuntimeRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PageExtensionRuntimeRegistryError';
  }
}

/**
 * Stores trusted local extension code separately from the JSON-only
 * PageRegistry. Registration snapshots metadata so later caller mutation
 * cannot change remote availability or scope contracts.
 */
export function createPageExtensionRuntimeRegistry(
  initial: Iterable<TrustedPageExtensionRuntime> = [],
): PageExtensionRuntimeRegistry {
  const runtimes = new Map<string, RegisteredPageExtensionRuntime>();

  const registry: PageExtensionRuntimeRegistry = {
    get(id) {
      return runtimes.get(id);
    },
    register(input) {
      const runtime = snapshotRuntime(input);
      if (runtimes.has(runtime.id)) {
        throw new PageExtensionRuntimeRegistryError(
          'extension.runtime.duplicate',
          `Extension runtime "${runtime.id}" is already registered.`,
        );
      }
      runtimes.set(runtime.id, runtime);
    },
    snapshot() {
      const snapshot = new Map(runtimes);
      return Object.freeze({
        get(id: string) {
          return snapshot.get(id);
        },
      });
    },
  };

  for (const runtime of initial) {
    registry.register(runtime);
  }
  return registry;
}

/** Exact scope-contract comparison shared by host and delivery validation. */
export function extensionScopeContractsMatch(
  left: readonly ScopeManifest[],
  right: readonly ScopeManifest[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftNames = new Set(left.map((scope) => scope.name));
  const rightNames = new Set(right.map((scope) => scope.name));
  if (leftNames.size !== left.length || rightNames.size !== right.length) {
    return false;
  }
  const byName = new Map(right.map((scope) => [scope.name, scope]));
  return left.every((scope) => {
    const candidate = byName.get(scope.name);
    return candidate !== undefined && scopeContractMatches(scope, candidate);
  });
}

/** A scope name, mode and schema are all part of an extension contract. */
export function scopeContractMatches(left: ScopeManifest, right: ScopeManifest): boolean {
  return left.name === right.name
    && left.mode === right.mode
    && structurallyEqual(left.value, right.value);
}

function snapshotRuntime(input: TrustedPageExtensionRuntime): RegisteredPageExtensionRuntime {
  if (!input || typeof input !== 'object') {
    throw new PageExtensionRuntimeRegistryError('extension.runtime.invalid', 'An extension runtime must be an object.');
  }
  if (!isIdentifier(input.id)) {
    throw new PageExtensionRuntimeRegistryError('extension.runtime.id.invalid', 'An extension runtime requires a non-empty id without whitespace.');
  }
  if (typeof input.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.version)) {
    throw new PageExtensionRuntimeRegistryError(
      'extension.runtime.version.invalid',
      `Extension runtime "${input.id}" must use an exact x.y.z SemVer version.`,
    );
  }
  if (input.allowRemote !== undefined && typeof input.allowRemote !== 'boolean') {
    throw new PageExtensionRuntimeRegistryError(
      'extension.runtime.remote.invalid',
      `Extension runtime "${input.id}" allowRemote must be a boolean when provided.`,
    );
  }
  if (typeof input.activate !== 'function') {
    throw new PageExtensionRuntimeRegistryError(
      'extension.runtime.activate.invalid',
      `Extension runtime "${input.id}" requires activate().`,
    );
  }
  const scopes = snapshotScopeContracts(input.scopes ?? [], input.id);
  return Object.freeze({
    activate: input.activate,
    allowRemote: input.allowRemote === true,
    id: input.id,
    scopes,
    version: input.version,
  });
}

function snapshotScopeContracts(input: readonly ScopeManifest[], runtimeId: string): readonly ScopeManifest[] {
  if (!Array.isArray(input)) {
    throw new PageExtensionRuntimeRegistryError(
      'extension.runtime.scopes.invalid',
      `Extension runtime "${runtimeId}" scopes must be an array.`,
    );
  }
  const names = new Set<string>();
  const scopes = input.map((scope, index) => {
    let clone: ScopeManifest;
    try {
      clone = cloneDomJson(scope as unknown as JsonValue, `Extension runtime "${runtimeId}" scope ${index}`) as unknown as ScopeManifest;
    } catch {
      throw new PageExtensionRuntimeRegistryError(
        'extension.runtime.scopes.invalid',
        `Extension runtime "${runtimeId}" scope ${index} must be JSON-compatible.`,
      );
    }
    if (!isScopeManifest(clone)) {
      throw new PageExtensionRuntimeRegistryError(
        'extension.runtime.scopes.invalid',
        `Extension runtime "${runtimeId}" scope ${index} is invalid.`,
      );
    }
    if (names.has(clone.name)) {
      throw new PageExtensionRuntimeRegistryError(
        'extension.runtime.scopes.duplicate',
        `Extension runtime "${runtimeId}" declares scope "${clone.name}" more than once.`,
      );
    }
    names.add(clone.name);
    return deepFreeze(clone);
  });
  return Object.freeze(scopes);
}

function isScopeManifest(value: ScopeManifest): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (Object.keys(value).some((key) => key !== 'mode' && key !== 'name' && key !== 'value')) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value.name)
    && !unsafeKeys.has(value.name)
    && (value.mode === 'read' || value.mode === 'readwrite');
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/\s/.test(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && structurallyEqual(leftRecord[key], rightRecord[key]));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
