import { createPageScope } from '../dom/scope.ts';
import type { JsonValue } from '../pagespec/types.ts';
import type { TrustedPageExtensionRuntime } from '../extensions/types.ts';
import {
  businessFormExtensionId,
  businessFormExtensionManifest,
  businessFormScope,
  businessFormScopeName,
} from './manifest.ts';

export class BusinessFormPresetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessFormPresetError';
  }
}

/**
 * The trusted runtime only creates fresh local draft state. It cannot invoke
 * capabilities, alter rendering, or interpret a workflow from config.
 */
export const businessFormRuntime: TrustedPageExtensionRuntime = {
  id: businessFormExtensionId,
  version: businessFormExtensionManifest.version,
  allowRemote: true,
  scopes: [businessFormScope],
  activate(context) {
    const initial = readInitialDrafts(context.config);
    const scope = createPageScope({
      extension: context.id,
      initial,
      mode: businessFormScope.mode,
      name: businessFormScopeName,
      value: businessFormScope.value,
    });
    return { scopes: [scope] };
  },
};

function readInitialDrafts(value: JsonValue): Record<string, Record<string, string>> {
  const configuredDrafts = isRecord(value) ? value.drafts : undefined;
  if (!isRecord(configuredDrafts)) {
    throw new BusinessFormPresetError('business-form.config.invalid', 'business-form requires a drafts object.');
  }
  const drafts: Record<string, Record<string, string>> = {};
  for (const [draftName, draft] of Object.entries(configuredDrafts)) {
    const configuredInitial = isRecord(draft) ? draft.initial : undefined;
    if (!isSafeSegment(draftName) || !isRecord(configuredInitial)) {
      throw new BusinessFormPresetError('business-form.config.draft.invalid', `Draft "${draftName}" is invalid.`);
    }
    const initial: Record<string, string> = {};
    for (const [fieldName, fieldValue] of Object.entries(configuredInitial)) {
      if (!isSafeSegment(fieldName) || typeof fieldValue !== 'string') {
        throw new BusinessFormPresetError(
          'business-form.config.field.invalid',
          `Draft "${draftName}" field "${fieldName}" must use a safe string value.`,
        );
      }
      initial[fieldName] = fieldValue;
    }
    drafts[draftName] = initial;
  }
  return drafts;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function isSafeSegment(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}
