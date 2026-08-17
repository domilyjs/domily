import type {
  ComponentCatalogManifest,
  ExtensionManifest,
  JsonSchema,
  ScopeManifest,
} from '../registry/types.ts';

export const businessFormExtensionId = '@domily/next/business-form';
export const businessFormScopeName = 'businessForm';

const styleSchema: JsonSchema = {
  type: ['object', 'string'],
  properties: {},
  additionalProperties: { type: ['number', 'string'] },
};

const stringRecordSchema: JsonSchema = {
  type: 'object',
  additionalProperties: { type: 'string' },
};

const fieldSchema: JsonSchema = {
  type: 'object',
  properties: {
    className: { type: 'string' },
    label: { type: 'string' },
    name: { type: 'string' },
    placeholder: { type: 'string' },
    required: { type: 'boolean' },
    style: styleSchema,
  },
  required: ['label', 'name'],
  additionalProperties: false,
};

const draftConfigSchema: JsonSchema = {
  type: 'object',
  properties: { initial: stringRecordSchema },
  required: ['initial'],
  additionalProperties: false,
};

const formEventPayload: JsonSchema = {
  type: 'object',
  properties: { value: stringRecordSchema },
  required: ['value'],
  additionalProperties: false,
};

/** The globally unique scope contract produced by the optional form preset. */
export const businessFormScope: ScopeManifest = {
  name: businessFormScopeName,
  mode: 'readwrite',
  value: {
    type: 'object',
    additionalProperties: stringRecordSchema,
  },
};

/** JSON-only contract selected by PageSpec; no runtime callbacks are stored here. */
export const businessFormExtensionManifest: ExtensionManifest = {
  schema: 'domily.extension/v1',
  id: businessFormExtensionId,
  version: '1.0.0',
  description: 'Optional page-local string draft forms for the native DOM host.',
  delivery: { remotePage: true },
  requires: { catalogs: [{ id: businessFormExtensionId, range: '^1' }] },
  config: {
    type: 'object',
    properties: {
      drafts: {
        type: 'object',
        additionalProperties: draftConfigSchema,
      },
    },
    required: ['drafts'],
    additionalProperties: false,
  },
  scopes: [businessFormScope],
};

/** Trusted component contract for a small, controlled string-draft form. */
export const businessFormCatalog: ComponentCatalogManifest = {
  schema: 'domily.component-catalog/v1',
  id: businessFormExtensionId,
  version: '1.0.0',
  namespace: 'business',
  description: 'Optional native DOM components for explicit string draft forms.',
  delivery: { remotePage: true },
  components: {
    form: {
      description: 'A trusted form renderer bound as one object to a page-local string draft.',
      props: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          fields: { type: 'array', minItems: 1, items: fieldSchema },
          style: styleSchema,
          submitLabel: { type: 'string' },
          value: stringRecordSchema,
        },
        required: ['fields', 'submitLabel', 'value'],
        additionalProperties: false,
      },
      bindings: {
        value: {
          mode: 'readwrite',
          value: stringRecordSchema,
          write: { event: 'input', valuePath: 'value' },
        },
      },
      events: {
        input: { description: 'Projects the complete string draft after an input change.', payload: formEventPayload },
        submit: { description: 'Projects the complete string draft after an explicit submit.', payload: formEventPayload },
      },
      styleForwarding: { className: true, style: true },
    },
  },
};
