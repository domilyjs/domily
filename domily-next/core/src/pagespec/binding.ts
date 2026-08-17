import type { JsonValue } from './types.ts';

const unsafeSegments = new Set(['__proto__', 'constructor', 'prototype']);

export interface BindingPath {
  readonly raw: string;
  readonly scope: string;
  readonly segments: readonly string[];
}

/** Raised only when a trusted host tries to materialize malformed input. */
export class BindingMaterializationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BindingMaterializationError';
  }
}

/** Returns a safe `$scope.path` reference, or undefined for a literal string. */
export function parseBindingPath(value: string): BindingPath | undefined {
  if (value.startsWith('$$') || !value.startsWith('$')) {
    return undefined;
  }
  const match = /^\$([A-Za-z][A-Za-z0-9_-]*)(?:\.([A-Za-z_$][A-Za-z0-9_$-]*))*$/.exec(value);
  if (!match) {
    return undefined;
  }
  const segments = value.slice(1).split('.');
  if (segments.some((segment) => unsafeSegments.has(segment))) {
    return undefined;
  }
  return { raw: value, scope: match[1]!, segments: segments.slice(1) };
}

export function isBindingReference(value: unknown): value is string {
  return typeof value === 'string' && parseBindingPath(value) !== undefined;
}

/** A single leading dollar requests binding syntax; `$$` is a literal escape. */
export function isBindingCandidate(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$') && !value.startsWith('$$');
}

/**
 * Resolves PageSpec template values without evaluating JavaScript. `$$` is the
 * public escape for a literal leading dollar and is intentionally unescaped
 * only at this final materialization boundary.
 */
export function materializeTemplate(
  value: JsonValue,
  resolve: (path: BindingPath) => JsonValue | undefined,
): JsonValue {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) {
      return value.slice(1);
    }
    if (!value.startsWith('$')) {
      return value;
    }
    const path = parseBindingPath(value);
    if (!path) {
      throw new BindingMaterializationError('binding.path.invalid', `Binding "${value}" is not a safe $scope.path reference.`);
    }
    const resolved = resolve(path);
    if (resolved === undefined) {
      throw new BindingMaterializationError('binding.value.unavailable', `Binding "${value}" is unavailable at render time.`);
    }
    return cloneJson(resolved);
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeTemplate(item, resolve));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materializeTemplate(item, resolve)]),
    );
  }
  return value;
}

export function readBindingPath(value: JsonValue, segments: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
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

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}
