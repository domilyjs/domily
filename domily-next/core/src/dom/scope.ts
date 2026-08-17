import type { JsonSchema, ScopeManifest } from '../registry/types.ts';
import type { JsonValue } from '../pagespec/types.ts';
import { cloneDomJson } from './value.ts';
import type { MutablePageScope } from './types.ts';

const unsafeSegments = new Set(['__proto__', 'constructor', 'prototype']);

export interface CreatePageScopeOptions<T extends JsonValue> {
  /** Registered extension that owns this scope, if it is not globally host-visible. */
  readonly extension?: string;
  readonly initial: T;
  readonly mode?: ScopeManifest['mode'];
  readonly name: string;
  readonly value?: JsonSchema;
}

export class PageScopeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PageScopeError';
  }
}

/** A small optional observable value primitive; it does not create global state. */
export function createPageScope<T extends JsonValue>(options: CreatePageScopeOptions<T>): MutablePageScope {
  return new MemoryPageScope(options);
}

class MemoryPageScope implements MutablePageScope {
  readonly extension?: string;
  readonly manifest: ScopeManifest;
  private readonly listeners = new Set<() => void>();
  private current: JsonValue;

  constructor(options: CreatePageScopeOptions<JsonValue>) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.name) || unsafeSegments.has(options.name)) {
      throw new PageScopeError('scope.name.invalid', 'A PageScope name must be a safe identifier.');
    }
    if (options.extension !== undefined
      && (typeof options.extension !== 'string' || options.extension.trim().length === 0 || /\s/.test(options.extension))) {
      throw new PageScopeError('scope.extension.invalid', 'A PageScope extension must be a safe registered extension id.');
    }
    this.extension = options.extension;
    this.manifest = Object.freeze({
      name: options.name,
      mode: options.mode ?? 'readwrite',
      ...(options.value ? { value: options.value } : {}),
    });
    this.current = cloneDomJson(options.initial, `Scope "${options.name}" initial value`);
  }

  read(path: readonly string[]): JsonValue | undefined {
    let current: JsonValue | undefined = this.current;
    for (const segment of path) {
      if (!isRecord(current) || !Object.hasOwn(current, segment)) {
        return undefined;
      }
      current = current[segment];
    }
    return current === undefined ? undefined : cloneDomJson(current, `Scope "${this.manifest.name}" read value`);
  }

  set(value: JsonValue): void {
    this.current = cloneDomJson(value, `Scope "${this.manifest.name}" value`);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  write(path: readonly string[], value: JsonValue): void {
    if (this.manifest.mode !== 'readwrite') {
      throw new PageScopeError('scope.write.readonly', `Scope "$${this.manifest.name}" is read-only.`);
    }
    if (path.some((segment) => !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment) || unsafeSegments.has(segment))) {
      throw new PageScopeError('scope.write.path.invalid', `Scope "$${this.manifest.name}" write path is unsafe.`);
    }
    this.current = writePath(this.current, path, cloneDomJson(value, `Scope "${this.manifest.name}" write value`));
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function writePath(root: JsonValue, path: readonly string[], value: JsonValue): JsonValue {
  if (path.length === 0) {
    return value;
  }
  const output = isRecord(root) ? cloneRecord(root) : {};
  let current = output;
  for (const [index, segment] of path.entries()) {
    if (index === path.length - 1) {
      current[segment] = value;
      continue;
    }
    const existing = current[segment];
    const next = isRecord(existing) ? cloneRecord(existing) : {};
    current[segment] = next;
    current = next;
  }
  return output;
}

function cloneRecord(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return cloneDomJson(value, 'Scope object') as Record<string, JsonValue>;
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}
