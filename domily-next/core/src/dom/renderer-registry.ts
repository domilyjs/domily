import type {
  DomComponentRendererRegistry,
  TrustedDomComponentRenderer,
} from './types.ts';

export class DomComponentRendererRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomComponentRendererRegistryError';
  }
}

export function createDomComponentRendererRegistry(
  initial: Iterable<TrustedDomComponentRenderer> = [],
): DomComponentRendererRegistry {
  const renderers = new Map<string, TrustedDomComponentRenderer>();

  const registry: DomComponentRendererRegistry = {
    get(type) {
      return renderers.get(type);
    },
    register(renderer) {
      if (!renderer || typeof renderer.type !== 'string' || !renderer.type) {
        throw new DomComponentRendererRegistryError('dom.renderer.type.invalid', 'A DOM renderer requires a non-empty type.');
      }
      if (typeof renderer.mount !== 'function') {
        throw new DomComponentRendererRegistryError('dom.renderer.mount.invalid', `Renderer "${renderer.type}" requires mount().`);
      }
      if (renderers.has(renderer.type)) {
        throw new DomComponentRendererRegistryError('dom.renderer.duplicate', `Renderer "${renderer.type}" is already registered.`);
      }
      renderers.set(renderer.type, Object.freeze(renderer));
    },
    snapshot() {
      const snapshot = new Map(renderers);
      return Object.freeze({
        get(type: string) {
          return snapshot.get(type);
        },
      });
    },
  };

  for (const renderer of initial) {
    registry.register(renderer);
  }
  return registry;
}
