import {
  createPageScope,
  type PageCapabilityHandler,
} from '@domily/next';
import type { JsonValue } from '@domily/next/pagespec';
import type { CapabilityCatalogManifest } from '@domily/next/registry';

export const profileScope = createPageScope({
  name: 'profile',
  initial: { lastSaved: '尚未保存资料。' },
  value: {
    type: 'object',
    properties: { lastSaved: { type: 'string' } },
    required: ['lastSaved'],
    additionalProperties: false,
  },
});

export const profileCapabilityCatalog: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@example/profile-capabilities',
  version: '1.0.0',
  capabilities: [{
    id: 'profile.save',
    version: '1.0.0',
    description: 'Saves display-name and email changes through trusted application code.',
    input: {
      type: 'object',
      properties: {
        displayName: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['displayName', 'email'],
      additionalProperties: false,
    },
    invocation: { localPage: true, remotePage: false },
  }],
};

/** Replace this handler with the application's API client without changing PageSpec. */
export const profileCapabilities: Record<string, PageCapabilityHandler> = {
  'profile.save': {
    invoke(_context, args) {
      const displayName = stringField(args, 'displayName').trim();
      const email = stringField(args, 'email').trim();
      profileScope.set({
        lastSaved: displayName && email
          ? `已保存 ${displayName} 的资料（${email}）。`
          : '显示名称和邮箱地址不能为空。',
      });
    },
  },
};

function stringField(value: JsonValue | undefined, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : '';
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
