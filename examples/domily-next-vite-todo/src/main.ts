import {
  createDomComponentRendererRegistry,
  createPageExtensionRuntimeRegistry,
  createPageHost,
  createPageRegistry,
} from '@domily/next';
import { registerBusinessFormPreset } from '@domily/next/business-form';
import { nativeHtmlCatalog, registerNativeHtmlRenderers } from '@domily/next/native-html';
import todoPage from './todo.dmy.ts';
import {
  todoCapabilities,
  todoCapabilityCatalog,
  todoComponentCatalog,
  todoListRenderer,
  todoScope,
} from './todo-service.ts';
import './style.css';

const registry = createPageRegistry();
registry.registerComponentCatalog(nativeHtmlCatalog);
registry.registerComponentCatalog(todoComponentCatalog);
registry.registerCapabilityCatalog(todoCapabilityCatalog);

const renderers = createDomComponentRendererRegistry();
registerNativeHtmlRenderers(renderers);
renderers.register(todoListRenderer);
const extensionRuntimes = createPageExtensionRuntimeRegistry();
registerBusinessFormPreset({ extensionRuntimes, registry, renderers });

const host = createPageHost({
  extensionRuntimes,
  registry,
  renderers,
  scopes: [todoScope],
  capabilities: todoCapabilities,
  onError(context) {
    console.error('[domily-next]', context.phase, context.error);
  },
});

void host.mount(todoPage, '#domily-root');
