import { DomilyAppDefault, PROVIDER_KEY } from "../../config";
import { $el, camelToKebab, parseAttribute, replaceDOM } from "../../utils/dom";
import { DOMilyChild, DOMilyMountableRender } from "../render";
import { domilyChildToDOMilyMountableRender } from "../render/shared/parse";

import { EventBus, EVENTS } from "../../utils/event-bus";
import { isFunction } from "../../utils/is";
import { handleWithFunType } from "../reactive/handle-effect";
import { DOMilyComponent, parseComponent } from "../component";
import { type WithFuncType } from "../reactive";

export interface DOMilyObjectPlugin<Options = {}> extends Record<string, any> {
  install: (app: DomilyApp<any, any>, options?: Options) => void;
}
export interface DOMilyFunctionPlugin<Options = {}> {
  (...args: any): any;
  install: (app: DomilyApp<any, any>, options?: Options) => void;
}

export type DOMilyPlugin<T, Options = {}> =
  | (DOMilyObjectPlugin<Options> & T)
  | (DOMilyFunctionPlugin<Options> & T);

export type DOMilyAppParamsRender<AppProps> = (
  props?: AppProps
) => DOMilyChild | (() => DOMilyChild);

export type DOMilyAppRender<AppProps> = (
  props?: AppProps
) => DOMilyMountableRender<any, any> | null;

export const DomilyAppInstances = new Map<
  string | symbol,
  DomilyApp<any, any>
>();

export type WithBaseProps<T = Record<string, any>> = T & {
  namespace: string | symbol;
};

export type DomilyAppOptions<
  GlobalProperties extends Record<string, any> = Record<string, any>
> = {
  namespace?: string | symbol;
  el?: string | HTMLElement;
  title?: string;
  globalProperties?: GlobalProperties;
  mode?: "SPA" | "MPA";
};

export default class DomilyApp<
  GlobalProperties extends Record<string, any> = Record<string, any>,
  AppProps extends Record<string, any> = Record<string, any>
> {
  el: string | HTMLElement;
  namespace: string | symbol;
  title: string;
  mode: "SPA" | "MPA";
  globalProperties: GlobalProperties;
  render: DOMilyAppRender<AppProps>;

  constructor(
    render: DOMilyAppParamsRender<AppProps>,
    options?: DomilyAppOptions<GlobalProperties>
  ) {
    this.namespace =
      options?.namespace || Symbol(`domily-app-${DomilyAppInstances.size + 1}`);
    this.el = options?.el || DomilyAppDefault.el;
    this.title = options?.title || DomilyAppDefault.title;
    this.mode = options?.mode || DomilyAppDefault.mode;
    this.globalProperties = (options?.globalProperties ||
      {}) as GlobalProperties;
    this.render = (props) =>
      domilyChildToDOMilyMountableRender(
        render(
          Object.assign(
            {
              namespace: this.namespace,
            },
            props
          )
        )
      );
    DomilyAppInstances.set(this.namespace, this);
  }

  static create<
    GlobalProperties extends Record<string, any> = Record<string, any>,
    AppProps extends Record<string, any> = Record<string, any>
  >(
    render: DOMilyAppParamsRender<AppProps>,
    options?: DomilyAppOptions<GlobalProperties>
  ) {
    return new DomilyApp(render, options);
  }

  use<T, Options = {}>(plugin: DOMilyPlugin<T, Options>, options?: Options) {
    if (isFunction(plugin.install)) {
      plugin.install.apply(plugin, [this, options]);
    }
    return this;
  }

  destroy() {
    DomilyAppInstances.delete(this.namespace);
  }

  defineCustomElement(
    name: string,
    component: DOMilyComponent,
    customElementOptions?: {
      useShadowDOM?: boolean;
      shadowDOMMode?: "open" | "closed";
      observedAttributes?: string[];
    }
  ) {
    name = camelToKebab(name);
    if (customElements.get(name)) {
      console.warn(`[Domily warn] Custom element ${name} already exists.`);
      return;
    }
    const namespace = this.namespace;
    const {
      useShadowDOM = false,
      shadowDOMMode = "open",
      observedAttributes: obAttrs = [],
    } = customElementOptions || {};
    customElements.define(
      name,
      class extends HTMLElement {
        shadowRoot: ShadowRoot | null = null;
        mountable: DOMilyMountableRender<any, any, any> | null = null;
        static observedAttributes = obAttrs;
        constructor() {
          super();
          if (useShadowDOM) {
            this.shadowRoot = this.attachShadow({
              mode: shadowDOMMode,
            });
          }
        }
        connectedCallback() {
          const attrs = Object.fromEntries(
            Array.from(this.attributes).map((e) => [
              e.name,
              parseAttribute(e.value),
            ])
          );
          this.mountable = parseComponent(
            {
              namespace,
              ...attrs,
            },
            component
          );
          if (!this.mountable) {
            console.warn(`[Domily warn] Custom element ${name} render failed.`);
            return;
          }
          const container =
            useShadowDOM && this.shadowRoot ? this.shadowRoot : this;
          this.mountable.mount(container);
        }
        disconnectedCallback() {
          this.mountable?.unmount();
        }
        attributeChangedCallback() {
          const attrs = Object.fromEntries(
            Array.from(this.attributes).map((e) => [
              e.name,
              parseAttribute(e.value),
            ])
          );
          const nextMountable = parseComponent(
            {
              namespace,
              ...attrs,
            },
            component
          );
          if (this.mountable?.schema?.__dom && nextMountable) {
            this.mountable.schema.__dom = replaceDOM(
              this.mountable.schema.__dom,
              nextMountable.schema.render()
            );
            if (isFunction(this.mountable.schema.updated)) {
              this.mountable.schema.updated(this.mountable.schema.__dom);
            }
          }
        }
      }
    );
  }
}

export function createApp<
  GlobalProperties extends Record<string, any> = Record<string, any>,
  AppProps extends Record<string, any> = Record<string, any>
>(
  render: DOMilyAppParamsRender<AppProps>,
  options?: DomilyAppOptions<GlobalProperties>,
  appProps?: AppProps
) {
  const appInstance = DomilyApp.create<GlobalProperties, AppProps>(
    render,
    options
  );
  return {
    app: appInstance,
    mount(parent?: HTMLElement | Document | ShadowRoot | string) {
      const comp = appInstance.render(appProps);
      if (!comp) {
        return null;
      }
      comp.mount(parent || appInstance.el);
      EventBus.emit(
        EVENTS.APP_MOUNTED,
        $el<HTMLElement>(parent || appInstance.el)
      );
      return () => {
        comp.unmount();
      };
    },
  };
}

export function getCurrentInstance(
  namespace?: string | symbol
): undefined | DomilyApp<any, any> {
  if (!namespace && DomilyAppInstances.size === 1) {
    return Array.from(DomilyAppInstances.values())[0];
  } else if (!namespace) {
    return;
  }
  return DomilyAppInstances.get(namespace);
}

// eslint-disable-next-line no-unused-vars
interface InjectionConstraint<T> {}
export type InjectionKey<T> = symbol & InjectionConstraint<T>;

export function provide<T, K = InjectionKey<T> | string | number>(
  key: K,
  data: K extends InjectionKey<infer V> ? V : T,
  namespace?: string | symbol
) {
  const appInstance = getCurrentInstance(namespace);
  if (!appInstance) {
    console.warn(
      `[Domily warn] No app instance found for namespace ${String(namespace)}.`
    );
    return;
  }
  const providers =
    appInstance.globalProperties[PROVIDER_KEY] ||
    new Map<string | symbol, any>();
  if (providers.has(key)) {
    console.warn(
      `[Domily warn] Provider with key ${String(key)} already exists.`
    );
    return;
  }
  providers.set(key, data);
  appInstance.globalProperties[PROVIDER_KEY] = providers;
}

export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue?: WithFuncType<T>,
  namespace?: string | symbol
): T | undefined {
  const appInstance = getCurrentInstance(namespace);
  const dv = handleWithFunType(defaultValue);
  if (!appInstance) {
    console.warn(
      `[Domily warn] No app instance found for namespace ${String(namespace)}.`
    );
    return dv;
  }
  const providers = appInstance.globalProperties[PROVIDER_KEY];
  if (!providers) {
    console.warn(
      `[Domily warn] No providers found for namespace ${String(namespace)}.`
    );
    return dv;
  }
  const data = providers.get(key);
  if (!data) {
    console.warn(`[Domily warn] Provider with key ${String(key)} not found.`);
    return dv;
  }

  return data;
}
