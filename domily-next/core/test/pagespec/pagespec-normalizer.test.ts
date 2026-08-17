import { describe, expect, test } from 'bun:test';

import {
  normalizePageSpec,
  PageSpecInputError,
  type PageSpec,
} from '../../src/pagespec/index.ts';
import {
  createPageRegistry,
  type CapabilityCatalogManifest,
  type ComponentCatalogManifest,
  type ExtensionManifest,
} from '../../src/registry/index.ts';

const appCatalog: ComponentCatalogManifest = {
  schema: 'domily.component-catalog/v1',
  id: '@example/app-ui',
  version: '1.2.0',
  namespace: 'app',
  components: {
    Button: {
      description: 'A project button.',
      props: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          label: { type: 'string' },
          style: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['label'],
        additionalProperties: false,
      },
      events: {
        click: {
          description: 'Projected click payload.',
          payload: { type: 'object', additionalProperties: true },
        },
      },
      bindings: {
        label: { mode: 'read' },
      },
    },
    Input: {
      description: 'A project input.',
      events: {
        input: {
          description: 'Projected input payload.',
          payload: {
            type: 'object',
            properties: { value: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      bindings: {
        value: { mode: 'readwrite', write: { event: 'input', valuePath: 'value' } },
      },
    },
  },
};

const capabilities: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@example/todos-capabilities',
  version: '1.0.0',
  capabilities: [
    {
      id: 'todos.create',
      version: '1.0.0',
      description: 'Creates a todo.',
      input: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
      invocation: { localPage: true, remotePage: true },
    },
  ],
};

const draftExtension: ExtensionManifest = {
  schema: 'domily.extension/v1',
  id: '@example/draft',
  version: '1.0.0',
  description: 'Provides a draft scope.',
  config: {
    type: 'object',
    properties: {
      initialTitle: { type: 'string' },
    },
    required: ['initialTitle'],
    additionalProperties: false,
  },
  scopes: [{ name: 'draft', mode: 'readwrite' }],
};

function registry() {
  const value = createPageRegistry();
  value.registerComponentCatalog(appCatalog);
  value.registerCapabilityCatalog(capabilities);
  value.registerExtension(draftExtension);
  return value;
}

function page(): PageSpec {
  return {
    schema: 'domily.page/v1',
    id: 'todos',
    requires: {
      catalogs: ['@example/app-ui@^1'],
      capabilities: ['todos.create@^1'],
      extensions: ['@example/draft@^1'],
    },
    extensions: {
      '@example/draft': { initialTitle: 'Read the proposal' },
    },
    ui: {
      type: 'app.Button',
      props: {
        className: 'todo-create',
        label: '$draft.title',
        style: { display: 'grid', gap: '12px' },
      },
      on: {
        click: {
          capability: 'todos.create',
          args: { title: '$draft.title' },
        },
      },
    },
  };
}

describe('PageSpec normalizer', () => {
  test('validates registered Catalog, capability, extension, binding, and open style props', () => {
    const result = normalizePageSpec(page(), { registry: registry() });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.requires.catalogs).toEqual([{ id: '@example/app-ui', range: '^1' }]);
    expect(result.value.requires.capabilities).toEqual([{ id: 'todos.create', range: '^1' }]);
    expect(result.value.ui.props).toMatchObject({
      className: 'todo-create',
      style: { display: 'grid', gap: '12px' },
    });
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  test('rejects a host scope that shadows an active extension scope', () => {
    const scope = draftExtension.scopes?.[0];
    if (!scope) throw new Error('Missing draft extension scope.');

    const result = normalizePageSpec(page(), {
      registry: registry(),
      scopes: [scope],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.scope.extension.shadowed' }),
      );
    }
  });

  test('rejects a component that was not declared through requires.catalogs', () => {
    const value = page();
    value.requires = { ...value.requires, catalogs: [] };

    const result = normalizePageSpec(value, { registry: registry() });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'pagespec.component.catalog-not-required', path: 'ui.type' }),
    );
  });

  test('rejects unknown scopes and extension config outside its namespace', () => {
    const unknownScope = page();
    unknownScope.ui.props = { ...unknownScope.ui.props, label: '$missing.title' };

    const scopeResult = normalizePageSpec(unknownScope, { registry: registry() });
    expect(scopeResult.ok).toBe(false);
    if (!scopeResult.ok) {
      expect(scopeResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.binding.scope.unknown', path: 'ui.props.label' }),
      );
    }

    const extensionResult = normalizePageSpec(
      { ...page(), extensions: { '@example/unknown': {} } },
      { registry: registry() },
    );
    expect(extensionResult.ok).toBe(false);
    if (!extensionResult.ok) {
      expect(extensionResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.unknown', path: 'extensions.@example/unknown' }),
      );
    }
  });

  test('rejects a two-way binding unless the component explicitly supports it', () => {
    const value = page();
    value.ui = {
      type: 'app.Button',
      bind: { label: '$draft.title' },
      props: { label: 'Create' },
    };

    const result = normalizePageSpec(value, { registry: registry() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.binding.mode.invalid', path: 'ui.bind.label' }),
      );
    }
  });

  test('keeps style open while rejecting code-execution props and undeclared top-level business fields', () => {
    const value = page() as PageSpec & { forms?: unknown };
    value.ui.props = {
      ...value.ui.props,
      innerHTML: '<img src=x onerror=alert(1)>',
      onClick: 'alert(1)',
      toString: 'must not resolve from Object.prototype',
    };
    value.forms = {};

    const result = normalizePageSpec(value, { registry: registry() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.prop.disallowed', path: 'ui.props.innerHTML' }),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.prop.disallowed', path: 'ui.props.onClick' }),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.prop.unknown', path: 'ui.props.toString' }),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.field.unknown', path: 'forms' }),
      );
    }
  });

  test('uses an explicit remote permission boundary and preserves escaped dollar literals', () => {
    const local = page();
    local.ui.props = { ...local.ui.props, label: '$$100' };

    const localResult = normalizePageSpec(local, { registry: registry() });
    expect(localResult.ok).toBe(true);
    if (localResult.ok) {
      expect(localResult.value.ui.props?.label).toBe('$$100');
    }

    const remoteResult = normalizePageSpec(page(), { registry: registry(), origin: 'remote' });
    expect(remoteResult.ok).toBe(false);
    if (!remoteResult.ok) {
      expect(remoteResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.component.remote.disallowed', path: 'ui.type' }),
      );
      expect(remoteResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.remote.disallowed', path: 'extensions.@example/draft' }),
      );
    }
  });

  test('enforces local and remote capability permissions independently', () => {
    const localBlocked: CapabilityCatalogManifest = {
      ...capabilities,
      capabilities: [{
        ...capabilities.capabilities[0]!,
        invocation: { localPage: false, remotePage: true },
      }],
    };
    const localRegistry = createPageRegistry();
    localRegistry.registerComponentCatalog(appCatalog);
    localRegistry.registerCapabilityCatalog(localBlocked);
    localRegistry.registerExtension(draftExtension);

    const localResult = normalizePageSpec(page(), { registry: localRegistry });
    expect(localResult.ok).toBe(false);
    if (!localResult.ok) {
      expect(localResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.capability.local.disallowed', path: 'ui.on.click.capability' }),
      );
    }

    const declarationOnly: PageSpec = {
      schema: 'domily.page/v1',
      id: 'declared-capability',
      requires: { catalogs: ['@example/app-ui'], capabilities: ['todos.create'] },
      ui: { type: 'app.Input' },
    };
    const declarationResult = normalizePageSpec(declarationOnly, { registry: localRegistry });
    expect(declarationResult.ok).toBe(false);
    if (!declarationResult.ok) {
      expect(declarationResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.requirement.capability.local.disallowed', path: 'requires.capabilities' }),
      );
    }

    const remoteBlocked: CapabilityCatalogManifest = {
      ...capabilities,
      capabilities: [{
        ...capabilities.capabilities[0]!,
        invocation: { localPage: true, remotePage: false },
      }],
    };
    const remoteRegistry = createPageRegistry();
    remoteRegistry.registerComponentCatalog({ ...appCatalog, delivery: { remotePage: true } });
    remoteRegistry.registerCapabilityCatalog(remoteBlocked);
    remoteRegistry.registerExtension({ ...draftExtension, delivery: { remotePage: true } });

    const remoteResult = normalizePageSpec(page(), { registry: remoteRegistry, origin: 'remote' });
    expect(remoteResult.ok).toBe(false);
    if (!remoteResult.ok) {
      expect(remoteResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.capability.remote.disallowed', path: 'ui.on.click.capability' }),
      );
    }
  });

  test('does not activate extension scopes until their namespaced configuration is present and valid', () => {
    const missingConfig = page();
    delete missingConfig.extensions;

    const result = normalizePageSpec(missingConfig, { registry: registry() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.config.missing', path: 'extensions' }),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.binding.scope.unknown', path: 'ui.props.label' }),
      );
    }
  });

  test('requires an enabled extension to expose its own declared dependencies through PageSpec', () => {
    const dependentExtension: ExtensionManifest = {
      ...draftExtension,
      requires: { capabilities: [{ id: 'todos.create', range: '^1' }] },
    };
    const dependentRegistry = createPageRegistry();
    dependentRegistry.registerComponentCatalog(appCatalog);
    dependentRegistry.registerCapabilityCatalog(capabilities);
    dependentRegistry.registerExtension(dependentExtension);
    const dependentPage = page();
    dependentPage.requires = {
      catalogs: ['@example/app-ui@^1'],
      extensions: ['@example/draft@^1'],
    };
    delete dependentPage.ui.on;

    const result = normalizePageSpec(dependentPage, { registry: dependentRegistry });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.capability.not-required', path: 'extensions.@example/draft' }),
      );
    }
  });

  test('applies the page origin permission boundary to extension dependencies', () => {
    const privateCatalog: ComponentCatalogManifest = {
      schema: 'domily.component-catalog/v1',
      id: '@example/private-ui',
      version: '1.0.0',
      namespace: 'private',
      delivery: { remotePage: false },
      components: { Marker: { description: 'A private marker.' } },
    };
    const restrictedCapabilities: CapabilityCatalogManifest = {
      schema: 'domily.capability-catalog/v1',
      id: '@example/secret-capabilities',
      version: '1.0.0',
      capabilities: [{
        id: 'secret.use',
        version: '1.0.0',
        description: 'Uses a private capability.',
        invocation: { localPage: true, remotePage: false },
      }],
    };
    const dependentExtension: ExtensionManifest = {
      schema: 'domily.extension/v1',
      id: '@example/dependent',
      version: '1.0.0',
      description: 'Needs private host contracts.',
      delivery: { remotePage: true },
      config: { type: 'object', additionalProperties: false },
      requires: {
        catalogs: [{ id: '@example/private-ui', range: '^1' }],
        capabilities: [{ id: 'secret.use', range: '^1' }],
      },
    };
    const remoteRegistry = createPageRegistry();
    remoteRegistry.registerComponentCatalog({ ...appCatalog, delivery: { remotePage: true } });
    remoteRegistry.registerComponentCatalog(privateCatalog);
    remoteRegistry.registerCapabilityCatalog(restrictedCapabilities);
    remoteRegistry.registerExtension(dependentExtension);
    const remotePage: PageSpec = {
      schema: 'domily.page/v1',
      id: 'remote-dependent',
      requires: {
        catalogs: ['@example/app-ui', '@example/private-ui'],
        capabilities: ['secret.use'],
        extensions: ['@example/dependent'],
      },
      extensions: { '@example/dependent': {} },
      ui: { type: 'app.Input' },
    };

    const remoteResult = normalizePageSpec(remotePage, { registry: remoteRegistry, origin: 'remote' });
    expect(remoteResult.ok).toBe(false);
    if (!remoteResult.ok) {
      expect(remoteResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.catalog.remote.disallowed' }),
      );
      expect(remoteResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.capability.remote.disallowed' }),
      );
    }

    const localOnlyCapabilities: CapabilityCatalogManifest = {
      ...restrictedCapabilities,
      capabilities: [{
        ...restrictedCapabilities.capabilities[0]!,
        invocation: { localPage: false, remotePage: true },
      }],
    };
    const localRegistry = createPageRegistry();
    localRegistry.registerComponentCatalog(appCatalog);
    localRegistry.registerComponentCatalog({ ...privateCatalog, delivery: { remotePage: true } });
    localRegistry.registerCapabilityCatalog(localOnlyCapabilities);
    localRegistry.registerExtension(dependentExtension);
    const localResult = normalizePageSpec(remotePage, { registry: localRegistry });
    expect(localResult.ok).toBe(false);
    if (!localResult.ok) {
      expect(localResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.extension.capability.local.disallowed' }),
      );
    }
  });

  test('rejects ambiguous props/bind ownership and missing capability input', () => {
    const collision = page();
    collision.ui = {
      type: 'app.Input',
      props: { value: 'draft' },
      bind: { value: '$draft.title' },
    };

    const collisionResult = normalizePageSpec(collision, { registry: registry() });
    expect(collisionResult.ok).toBe(false);
    if (!collisionResult.ok) {
      expect(collisionResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.binding.prop.conflict', path: 'ui.bind.value' }),
      );
    }

    const missingArgs = page();
    delete missingArgs.ui.on?.click?.args;

    const argsResult = normalizePageSpec(missingArgs, { registry: registry() });
    expect(argsResult.ok).toBe(false);
    if (!argsResult.ok) {
      expect(argsResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.capability.args.required', path: 'ui.on.click.args' }),
      );
    }
  });

  test('rejects component-local scope declarations until a trusted scope-producing renderer exists', () => {
    const scopedCatalog = {
      ...appCatalog,
      components: {
        ...appCatalog.components,
        ScopeProvider: {
          description: 'Provides an item scope to children.',
          children: {},
          scopes: [{
            name: 'item',
            mode: 'readwrite',
            value: {
              type: 'object',
              properties: { title: { type: 'string' } },
              additionalProperties: false,
            },
          }],
        },
      },
    } as unknown as ComponentCatalogManifest;
    const scopedRegistry = createPageRegistry();
    expect(() => scopedRegistry.registerComponentCatalog(scopedCatalog)).toThrow('cannot contain field');
  });

  test('validates required props and binding paths against declared scope and event schemas', () => {
    const strictCatalog: ComponentCatalogManifest = {
      ...appCatalog,
      components: {
        ...appCatalog.components,
        Button: {
          ...appCatalog.components.Button!,
          events: {
            click: {
              description: 'A typed click projection.',
              payload: {
                type: 'object',
                properties: { title: { type: 'string' } },
                required: ['title'],
                additionalProperties: false,
              },
            },
          },
        },
        Input: {
          ...appCatalog.components.Input!,
          props: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    };
    const strictRegistry = createPageRegistry();
    strictRegistry.registerComponentCatalog(strictCatalog);
    strictRegistry.registerCapabilityCatalog(capabilities);
    strictRegistry.registerExtension(draftExtension);

    const missingProp = page();
    missingProp.ui.props = { className: 'missing-label' };
    const missingPropResult = normalizePageSpec(missingProp, { registry: strictRegistry });
    expect(missingPropResult.ok).toBe(false);
    if (!missingPropResult.ok) {
      expect(missingPropResult.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.prop.required', path: 'ui.props.label' }),
      );
    }

    const requiredBinding = page();
    requiredBinding.ui = { type: 'app.Input', bind: { value: '$draft.title' } };
    expect(normalizePageSpec(requiredBinding, { registry: strictRegistry }).ok).toBe(true);

    const eventPage = page();
    eventPage.ui.props = { label: 'Create' };
    eventPage.ui.on = {
      click: {
        capability: 'todos.create',
        args: { title: '$event.title' },
      },
    };
    expect(normalizePageSpec(eventPage, { registry: strictRegistry }).ok).toBe(true);

    eventPage.ui.on.click!.args = { title: '$event.missing' };
    const missingEventPath = normalizePageSpec(eventPage, { registry: strictRegistry });
    expect(missingEventPath.ok).toBe(false);
    if (!missingEventPath.ok) {
      expect(missingEventPath.issues).toContainEqual(
        expect.objectContaining({ code: 'pagespec.binding.path.unknown', path: 'ui.on.click.args.title' }),
      );
    }
  });

  test('accepts a catalog-defined html tree alongside application components without business presets', () => {
    const htmlCatalog: ComponentCatalogManifest = {
      schema: 'domily.component-catalog/v1',
      id: '@example/native-html',
      version: '1.0.0',
      namespace: 'html',
      components: {
        div: {
          description: 'A native div.',
          children: {},
          props: {
            type: 'object',
            properties: {
              className: { type: 'string' },
              style: { type: 'object', additionalProperties: true },
            },
            additionalProperties: false,
          },
        },
      },
    };
    const htmlRegistry = createPageRegistry();
    htmlRegistry.registerComponentCatalog(htmlCatalog);
    htmlRegistry.registerComponentCatalog(appCatalog);

    const htmlPage: PageSpec = {
      schema: 'domily.page/v1',
      id: 'native-page',
      requires: { catalogs: ['@example/native-html', '@example/app-ui'] },
      ui: {
        type: 'html.div',
        props: { className: 'layout', style: { display: 'grid' } },
        children: [{ type: 'app.Input' }],
      },
    };

    expect(normalizePageSpec(htmlPage, { registry: htmlRegistry }).ok).toBe(true);
  });

  test('throws for a circular source graph instead of accepting a non-serializable page', () => {
    const value = page() as PageSpec & { cycle?: unknown };
    value.cycle = value;

    expect(() => normalizePageSpec(value, { registry: registry() })).toThrow(PageSpecInputError);
  });
});
