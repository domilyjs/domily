import {
  createDomComponentRendererRegistry,
  createPageExtensionRuntimeRegistry,
  createPageHost,
  createPageRegistry,
} from '@domily/next';
import { registerBusinessFormPreset } from '@domily/next/business-form';
import { nativeHtmlCatalog, registerNativeHtmlRenderers } from '@domily/next/native-html';
import profilePage from './profile.dmy.ts';
import {
  profileCapabilities,
  profileCapabilityCatalog,
  profileScope,
} from './profile-service.ts';
import './style.css';

const registry = createPageRegistry();
registry.registerComponentCatalog(nativeHtmlCatalog);
registry.registerCapabilityCatalog(profileCapabilityCatalog);

const renderers = createDomComponentRendererRegistry();
registerNativeHtmlRenderers(renderers);
const extensionRuntimes = createPageExtensionRuntimeRegistry();
registerBusinessFormPreset({ extensionRuntimes, registry, renderers });

const host = createPageHost({
  capabilities: profileCapabilities,
  extensionRuntimes,
  registry,
  renderers,
  scopes: [profileScope],
  onError(context) {
    console.error('[domily-next]', context.phase, context.error);
  },
});

void host.mount(profilePage, '#domily-root');
