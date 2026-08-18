import type { JsonValue } from '../pagespec/types.ts';

/** Raised when a codec attempts to return a value outside the protocol data model. */
export class SourceCodecValueError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceCodecValueError';
  }
}

/**
 * Defensively clones the only values a source codec may expose: finite JSON
 * primitives, ordinary dense arrays, and plain data objects. It never reads
 * accessors or invokes serialization hooks. JSON keys remain generic here;
 * PageSpec and manifest boundaries apply their own key policy.
 */
export function cloneSourceJson(value: unknown, label: string): JsonValue {
  return clone(value, label, '', new WeakSet<object>());
}

function clone(value: unknown, label: string, path: string, ancestors: WeakSet<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw invalid('codec.value.number.invalid', `${label} ${formatPath(path)} must be a finite number.`);
  }
  if (!value || typeof value !== 'object') {
    throw invalid('codec.value.json.invalid', `${label} ${formatPath(path)} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw invalid('codec.value.json.circular', `${label} contains a circular value at ${formatPath(path)}.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid('codec.value.json.symbol', `${label} ${formatPath(path)} cannot use symbol keys.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneArray(value, label, path, ancestors);
    return cloneObject(value, label, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function cloneArray(value: unknown[], label: string, path: string, ancestors: WeakSet<object>): JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalid('codec.value.json.invalid', `${label} ${formatPath(path)} must use an ordinary array.`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue;
    if (!isArrayIndex(key, value.length)) {
      throw invalid('codec.value.json.array-property', `${label} ${formatPath(path)} cannot use non-index array property "${key}".`);
    }
  }
  const result: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw invalid('codec.value.json.sparse', `${label} ${formatPath(path)} cannot use sparse arrays.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalid('codec.value.json.invalid', `${label} ${formatPath(`${path}[${index}]`)} cannot use accessors or hidden values.`);
    }
    result.push(clone(descriptor.value, label, `${path}[${index}]`, ancestors));
  }
  return result;
}

function cloneObject(
  value: object,
  label: string,
  path: string,
  ancestors: WeakSet<object>,
): Record<string, JsonValue> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid('codec.value.json.invalid', `${label} ${formatPath(path)} must use a plain object.`);
  }
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.getOwnPropertyNames(value)) {
    const childPath = joinPath(path, key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw invalid('codec.value.json.invalid', `${label} ${formatPath(childPath)} cannot use accessors or hidden values.`);
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: clone(descriptor.value, label, childPath, ancestors),
      writable: false,
    });
  }
  return result;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function formatPath(path: string): string {
  return path || '<root>';
}

function invalid(code: string, message: string): SourceCodecValueError {
  return new SourceCodecValueError(code, message);
}
