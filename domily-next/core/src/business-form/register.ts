import type { DomComponentRendererRegistry } from '../dom/types.ts';
import type { PageExtensionRuntimeRegistry } from '../extensions/types.ts';
import type { PageRegistry } from '../registry/types.ts';
import { businessFormCatalog, businessFormExtensionManifest } from './manifest.ts';
import { businessFormRenderer } from './renderer.ts';
import { businessFormRuntime } from './runtime.ts';

export interface RegisterBusinessFormPresetOptions {
  readonly extensionRuntimes: PageExtensionRuntimeRegistry;
  readonly registry: PageRegistry;
  readonly renderers: DomComponentRendererRegistry;
}

/** Registers all local pieces of the optional preset in one application-startup call. */
export function registerBusinessFormPreset(options: RegisterBusinessFormPresetOptions): void {
  options.registry.registerComponentCatalog(businessFormCatalog);
  options.registry.registerExtension(businessFormExtensionManifest);
  options.renderers.register(businessFormRenderer);
  options.extensionRuntimes.register(businessFormRuntime);
}
