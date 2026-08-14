import {
  createMvpDomRegistry,
  validateDocument,
  type DomComponentRegistry,
} from '@domily/next';
import {
  domilyNext as createVitePlugin,
  type DomilyNextVitePluginOptions,
  type DomilyVitePlugin,
} from './transform.ts';

export {
  DomilyViteCompileError,
  domilyNext,
  transformDomilyAuthorModule,
} from './transform.ts';

export type {
  DomilyNextVitePluginOptions,
  DomilyViteConfigPatch,
  DomilyViteErrorLocation,
  DomilyVitePlugin,
  DomilyViteTransformResult,
  DomilyViteValidationResult,
} from './transform.ts';

export default createVitePlugin;

export interface DomilyViteOptions {
  capabilities?: Iterable<string> | Readonly<Record<string, unknown>>;
  components?: DomComponentRegistry;
  extensions?: DomilyNextVitePluginOptions['extensions'];
}

/**
 * Vite convenience entrypoint that shares the default DOM policy with
 * createDomilyApp and derives the capability allowlist from a handler record.
 */
export function domilyVite(options: DomilyViteOptions = {}): DomilyVitePlugin {
  const components = options.components ?? createMvpDomRegistry();
  const capabilities = capabilityNames(options.capabilities);
  return createVitePlugin({
    ...(options.extensions ? { extensions: options.extensions } : {}),
    validate(document) {
      return validateDocument(document, { capabilities, components });
    },
  });
}

function capabilityNames(input: DomilyViteOptions['capabilities']): Set<string> {
  if (!input) return new Set();
  if (typeof input === 'string') return new Set([input]);
  if (Symbol.iterator in Object(input)) return new Set(input as Iterable<string>);
  return new Set(Object.keys(input));
}
