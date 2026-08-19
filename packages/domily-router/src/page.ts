import {
  EB,
  ISUtils,
  parseComponent,
  type DOMilyComponent,
  type AsyncDOMilyComponentModule,
  type DOMilyMountableRender,
  DomilyAppInstances,
} from "@domily/runtime-core";
import { ROUTER_EVENTS } from "./event";
import type { IMatchedPage } from "./base";
const { isFunction, isThenable } = ISUtils;
const { EventBus } = EB;

export interface IDomilyPageSchema<
  PageMeta = {},
  Props extends Record<string, any> = {}
> {
  name?: string;
  namespace?: string | symbol;
  path: string;
  alias?: string | string[];
  component?: DOMilyComponent | AsyncDOMilyComponentModule;
  redirect?: { name?: string; path?: string };
  meta?: PageMeta;
  children?: IDomilyPageSchema[];
  props?: Props;
}

export default class DomilyPageSchema<
  PageMeta = {},
  Props extends Record<string, any> = {}
> {
  name?: string;
  namespace: string | symbol;
  path: string;
  alias?: string | string[];
  component?: DOMilyComponent | AsyncDOMilyComponentModule;
  redirect?: { name?: string; path?: string };
  meta?: PageMeta;
  children?: DomilyPageSchema<unknown>[];
  props?: Props;
  private functionComponent: DOMilyComponent | null = null;
  private asyncComponentLoading = false;
  private mountedComponent: DOMilyMountableRender<any, any, any> | null = null;

  constructor(schema: IDomilyPageSchema<PageMeta, Props>) {
    this.name = schema.name;
    this.namespace = schema.namespace ?? Symbol("DomilyAppNamespace");
    this.path = schema.path;
    this.alias = schema.alias;
    this.component = schema.component;
    this.redirect = schema.redirect;
    this.meta = schema.meta;
    this.props = schema.props;
    this.children = schema.children?.map((child) =>
      new DomilyPageSchema<unknown>({
        ...child,
        namespace: child.namespace ?? this.namespace,
      })
    );
  }

  static create<PageMeta = {}, Props extends Record<string, any> = {}>(
    schema: IDomilyPageSchema<PageMeta, Props>
  ) {
    return new DomilyPageSchema(schema);
  }

  #toView(
    component: DOMilyComponent,
    el: HTMLElement | Document | ShadowRoot | string,
    groupKey?: string
  ) {
    if (this.mountedComponent?.schema?.__dom) {
      this.mountedComponent.mount(el);
    } else {
      const comp = parseComponent(
        Object.assign(
          {
            namespace: this.namespace,
          },
          this.props
        ),
        component
      );
      if (!comp) {
        return null;
      }
      comp.mount(el);
      this.mountedComponent = comp;
    }
    EventBus.emit<IMatchedPage>(
      ROUTER_EVENTS.PAGE_MOUNTED,
      Object.assign(
        { ...this },
        {
          comp: this.mountedComponent,
          groupKey,
        }
      )
    );
    return this.mountedComponent;
  }

  render(el: HTMLElement | Document | ShadowRoot | string, groupKey?: string) {
    const { resolve, reject, promise } =
      Promise.withResolvers<DOMilyMountableRender<any, any> | null>();

    if (this.redirect) {
      const app = DomilyAppInstances.get(this.namespace);
      if (!app || !app?.globalProperties?.$router) {
        resolve(null);
        return promise;
      }
      const router = app.globalProperties.$router;
      const { path, name } = this.redirect;
      if (path) {
        resolve(router.routesPathFlatMap[path]?.render(el, groupKey) || null);
      } else if (name) {
        resolve(router.routesNameFlatMap[name]?.render(el, groupKey) || null);
      } else {
        resolve(null);
      }
      return promise;
    }

    if (isThenable(this.component)) {
      this.asyncComponentLoading = true;
      this.component
        .then(({ default: comp }) => {
          this.functionComponent = comp;
        })
        .catch(reject)
        .finally(() => {
          this.asyncComponentLoading = false;
          if (isFunction(this.functionComponent)) {
            resolve(this.#toView(this.functionComponent, el, groupKey));
          } else {
            resolve(null);
          }
        });
    } else if (isFunction(this.component)) {
      this.functionComponent = this.component;
      resolve(this.#toView(this.functionComponent, el, groupKey));
    } else {
      resolve(null);
    }
    return promise;
  }
}

export function page<PageMeta = {}, Props extends Record<string, any> = {}>(
  schema: IDomilyPageSchema<PageMeta, Props>
) {
  const pageInstance = DomilyPageSchema.create(schema);

  return {
    page: pageInstance,
    mount(parent: HTMLElement | Document | ShadowRoot | string) {
      return pageInstance.render(parent);
    },
  };
}
