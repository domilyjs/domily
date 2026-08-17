import type { JsonValue } from '../pagespec/types.ts';

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export class DomJsonValueError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomJsonValueError';
  }
}

/** Clones values that cross from a local renderer/handler into protocol code. */
export function cloneDomJson(value: unknown, label: string): JsonValue {
  return clone(value, label, '', new WeakSet<object>());
}

function clone(value: unknown, label: string, path: string, ancestors: WeakSet<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalid('dom.value.number.invalid', `${label} ${formatPath(path)} must be a finite number.`);
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw invalid('dom.value.json.invalid', `${label} ${formatPath(path)} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw invalid('dom.value.json.circular', `${label} contains a circular value at ${formatPath(path)}.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid('dom.value.json.symbol', `${label} ${formatPath(path)} cannot use symbol keys.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value);
      if (ownNames.some((name) => name !== 'length' && !/^\d+$/.test(name))) {
        throw invalid('dom.value.json.array-property', `${label} ${formatPath(path)} cannot use non-index array properties.`);
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw invalid('dom.value.json.sparse', `${label} ${formatPath(path)} cannot use sparse arrays.`);
        }
        result.push(clone(value[index], label, `${path}[${index}]`, ancestors));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalid('dom.value.json.invalid', `${label} ${formatPath(path)} must use a plain object.`);
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw invalid('dom.value.json.invalid', `${label} ${formatPath(joinPath(path, key))} cannot use accessors or hidden fields.`);
      }
      if (unsafeKeys.has(key)) {
        throw invalid('dom.value.json.unsafe-key', `${label} ${formatPath(joinPath(path, key))} uses an unsafe key.`);
      }
      result[key] = clone(descriptor.value, label, joinPath(path, key), ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function formatPath(path: string): string {
  return path || '<root>';
}

function invalid(code: string, message: string): DomJsonValueError {
  return new DomJsonValueError(code, message);
}
