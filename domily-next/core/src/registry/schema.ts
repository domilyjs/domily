import type { JsonValue, PageSpecIssue } from '../pagespec/types.ts';
import type { JsonSchema, JsonSchemaType } from './types.ts';

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export function validateJsonSchema(value: JsonValue, schema: JsonSchema | undefined, path: string): PageSpecIssue[] {
  if (!schema) {
    return [];
  }
  const issues: PageSpecIssue[] = [];
  validate(value, schema, path, issues);
  return issues;
}

function validate(value: JsonValue, schema: JsonSchema, path: string, issues: PageSpecIssue[]): void {
  if (schema.const !== undefined && !jsonEquals(value, schema.const)) {
    issues.push(issue('pagespec.schema.const', 'Value must equal the declared constant.', path));
    return;
  }
  if (schema.enum && !schema.enum.some((candidate) => jsonEquals(value, candidate))) {
    issues.push(issue('pagespec.schema.enum', 'Value is not one of the declared enum values.', path));
    return;
  }

  const expectedTypes = schema.type === undefined
    ? []
    : Array.isArray(schema.type)
      ? schema.type
      : [schema.type];
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => matchesType(value, type))) {
    issues.push(issue('pagespec.schema.type', `Expected ${expectedTypes.join(' or ')} value.`, path));
    return;
  }

  if (Array.isArray(value)) {
    validateArray(value, schema, path, issues);
    return;
  }
  if (isRecord(value)) {
    validateObject(value, schema, path, issues);
    return;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push(issue('pagespec.schema.min-length', `String must contain at least ${schema.minLength} characters.`, path));
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push(issue('pagespec.schema.max-length', `String must contain at most ${schema.maxLength} characters.`, path));
    }
    return;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(issue('pagespec.schema.minimum', `Number must be at least ${schema.minimum}.`, path));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(issue('pagespec.schema.maximum', `Number must be at most ${schema.maximum}.`, path));
    }
  }
}

function validateArray(value: JsonValue[], schema: JsonSchema, path: string, issues: PageSpecIssue[]): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    issues.push(issue('pagespec.schema.min-items', `Array must contain at least ${schema.minItems} items.`, path));
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    issues.push(issue('pagespec.schema.max-items', `Array must contain at most ${schema.maxItems} items.`, path));
  }
  if (schema.items) {
    value.forEach((item, index) => validate(item, schema.items!, `${path}[${index}]`, issues));
  }
}

function validateObject(
  value: { [key: string]: JsonValue },
  schema: JsonSchema,
  path: string,
  issues: PageSpecIssue[],
): void {
  const properties = schema.properties ?? {};
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(value, required)) {
      issues.push(issue('pagespec.schema.required', `Property "${required}" is required.`, `${path}.${required}`));
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (unsafeKeys.has(key)) {
      issues.push(issue('pagespec.schema.key.unsafe', `Property "${key}" is not allowed.`, `${path}.${key}`));
      continue;
    }
    const propertySchema = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (!propertySchema && schema.additionalProperties === false) {
      issues.push(issue('pagespec.schema.property.unknown', `Property "${key}" is not allowed.`, `${path}.${key}`));
      continue;
    }
    if (propertySchema) {
      validate(item, propertySchema, `${path}.${key}`, issues);
    } else if (typeof schema.additionalProperties === 'object') {
      validate(item, schema.additionalProperties, `${path}.${key}`, issues);
    }
  }
}

function matchesType(value: JsonValue, type: JsonSchemaType): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number';
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
  }
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonEquals(item, right[index]!));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && jsonEquals(left[key]!, right[key]!));
  }
  return false;
}

function issue(code: string, message: string, path: string): PageSpecIssue {
  return { code, message, path };
}
