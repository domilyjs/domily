import {
  DomilyApp,
  DomilyRouterView,
  EB,
  ISUtils,
  type DOMilyMountableRender,
} from "@domily/runtime-core";
import {
  combinePaths,
  generateFullUrl,
  handleStringPathname,
  type IMatchedRoute,
  matchRoute,
  removeEndSlash,
} from "./match";
import { ROUTER_EVENTS } from "./event";
import DomilyPageSchema, { type IDomilyPageSchema } from "./page";

const { EventBus, EVENTS } = EB;

const GroupKey = {
  count: 0,
  increase: (text: string) => {
    GroupKey.count++;
    return `${text}-${GroupKey.count}`;
  },
};

const wildcardPath = "/*";

const getGroupKey = (route?: IMatchedRoute | null) =>
  GroupKey.increase(route?.name || route?.path || "GROUP");

export interface ICreateRouterOptions {
  mode?: "history" | "hash";
  base?: string;
  routes?: IDomilyPageSchema<any, any>[];
}

export interface IRouterOptions {
  name?: string;
  path?: string;
  query?: Record<string, string>;
  params?: Record<string, string>;
  hash?: string;
}

export interface IMatchedPage extends IMatchedRoute {
  comp: DOMilyMountableRender<any, any>;
  groupKey?: string;
}

export interface IRouterBeforeEach {
  (
    from: IMatchedPage | undefined | null,
    to: IMatchedRoute | undefined | null,
    next: (to?: IRouterOptions | IMatchedPage | IMatchedRoute | string) => void
  ): void;
}
export interface IRouterAfterEach {
  (route: IMatchedRoute | undefined | null): void;
}

export default abstract class DomilyRouterBase {
  mode: "history" | "hash" = "hash";
  /**
   * init router for the specific router
   */
  abstract initRouter(): void;
  base: string = "/";
  /**
   * the store for the global page router history
   */
  GLobalPageRouterHistoryStoreMap: Map<string, IMatchedPage[]> = new Map();
  GLobalPageRouterHistoryStoreMapLastKey?: string;
  /**
   * the queue for the global page rendering
   */
  GLobalPageRouterRenderingQueue: (() => Promise<any>)[] = [];
  /**
   * the rendering-loading for the global page rendering
   */
  GLobalPageRouterRendering = false;
  /**
   * if the initial has been completed
   */
  initialed = false;
  /**
   * the application root dom node
   */
  root: HTMLElement | Document | ShadowRoot | undefined | null = null;
  /**
   * the current route on the page
   */
  currentRoute?: IMatchedRoute | null = null;
  /**
   * the current domily application DomilyApp
   */
  app: DomilyApp;
  /**
   * the router page config
   */
  routes: DomilyPageSchema<any>[] = [];
  /**
   * the router 'path' map
   */
  get routesPathMap() {
    return Object.fromEntries(this.routes.map((e) => [e.path, e]));
  }
  /**
   * the router 'path' flat map by 'children'
   */
  get routesPathFlatMap() {
    const result: Record<
      string,
      DomilyPageSchema<any> & { parent?: DomilyPageSchema<any> | null }
    > = {};
    const getChildRoutes = (
      routes: DomilyPageSchema<any>[],
      parent: DomilyPageSchema<any> | null = null
    ) => {
      routes.forEach((e) => {
        result[combinePaths(parent?.path, e.path)] = Object.assign(e, {
          parent,
        });
        if (e.children) {
          getChildRoutes(e.children, e);
        }
      });
    };
    getChildRoutes(this.routes);
    return result;
  }
  /**
   * the router 'name' map
   */
  get routesNameMap() {
    return Object.fromEntries(this.routes.map((e) => [e.name || e.path, e]));
  }
  /**
   * the router 'name' flat map by 'children'
   */
  get routesNameFlatMap() {
    const result: Record<
      string,
      DomilyPageSchema<any> & { parent?: DomilyPageSchema<any> | null }
    > = {};
    const getChildRoutes = (
      routes: DomilyPageSchema<any>[],
      parent: DomilyPageSchema<any> | null = null
    ) => {
      routes.forEach((e) => {
        result[e.name || e.path] = Object.assign(e, {
          parent,
        });
        if (e.children) {
          getChildRoutes(e.children, e);
        }
      });
    };
    getChildRoutes(this.routes);
    return result;
  }
  /**
   * before matched the router callback
   */
  beforeEach: IRouterBeforeEach[] = [];
  /**
   * after matched the router rendered callback
   */
  afterEach: IRouterAfterEach[] = [];

  constructor(app: DomilyApp, options?: ICreateRouterOptions) {
    const { routes, base = "/", mode = "hash" } = options || {};
    this.base = base;
    this.app = app;
    this.mode = mode;
    this.routes =
      routes?.map((e) => {
        e.namespace = e.namespace || app.namespace;
        e.path = removeEndSlash(
          e.path.startsWith(wildcardPath)
            ? e.path
            : e.path.startsWith("*")
            ? wildcardPath
            : combinePaths(base, e.path)
        );
        return DomilyPageSchema.create(e);
      }) || [];
    this.currentRoute = this.match();
    this.init();
  }

  init() {
    if (this.initialed) {
      return;
    }
    /**
     * enqueue page-render-promise when page mounted
     */
    EventBus.on<IMatchedPage>(ROUTER_EVENTS.PAGE_MOUNTED, (e) => {
      if (!e.groupKey) {
        e.groupKey = getGroupKey(e);
      }
      const item = this.GLobalPageRouterHistoryStoreMap.get(e.groupKey);
      if (!item) {
        this.GLobalPageRouterHistoryStoreMap.set(e.groupKey, [e]);
      } else {
        this.GLobalPageRouterHistoryStoreMap.set(e.groupKey, [...item, e]);
      }
    });

    this.initRouter();
    EventBus.on<HTMLElement | Document | ShadowRoot | undefined | null>(
      EVENTS.APP_MOUNTED,
      (e) => {
        this.root = e;
        this.matchPage();
      }
    );
    globalThis.addEventListener("popstate", (e: PopStateEvent) => {
      let fullPath =
        this.mode === "history"
          ? location.href.replace(location.origin, "")
          : location.hash.slice(1);
      let pageXOffset = 0;
      let pageYOffset = 0;
      if (e.state && typeof e.state === "object") {
        const { name, path, query, params, x, y } = e.state;
        const resolved = this.resolve({
          name,
          path,
          query,
          params,
        });
        if (resolved?.fullPath) {
          fullPath = resolved.fullPath;
          pageXOffset = x;
          pageYOffset = y;
        }
      }
      this.matchPage(fullPath, {
        afterRendered(rendered) {
          if (rendered) {
            globalThis.pageXOffset = pageXOffset;
            globalThis.pageYOffset = pageYOffset;
          }
        },
      });
    });
    this.initialed = true;
  }

  obtainHistoryState(
    matched: IRouterOptions | IMatchedRoute | undefined | null
  ) {
    return {
      name: matched?.name,
      path: matched?.path,
      query: matched?.query,
      params: matched?.params,
      x: globalThis.pageXOffset,
      y: globalThis.pageYOffset,
    };
  }

  async executeQueueRender() {
    if (this.GLobalPageRouterRendering) {
      return;
    }
    this.GLobalPageRouterRendering = true;
    while (this.GLobalPageRouterRenderingQueue.length) {
      const promise = this.GLobalPageRouterRenderingQueue.shift();
      if (typeof promise === "function") {
        await promise();
      }
    }
    this.GLobalPageRouterRendering = false;
  }

  async prepareRouterView(
    item: IMatchedRoute | IMatchedPage,
    routerViewHTMLElement: HTMLElement,
    groupKey?: string
  ) {
    routerViewHTMLElement.childNodes.forEach((e) => e.remove());
    routerViewHTMLElement.setAttribute("path", item.path);
    return await item.render(routerViewHTMLElement, groupKey);
  }

  async deepRender(matched?: IMatchedRoute | null, groupKey?: string) {
    await Promise.resolve().then();
    if (!this.root || !matched) {
      return false;
    }
    const rootRouterView = this.root.querySelector<HTMLElement>(
      DomilyRouterView.name
    );
    if (!rootRouterView) {
      return false;
    }
    const parents: IMatchedRoute[] = [matched];
    const getParents = (matched: IMatchedRoute) => {
      if (matched.parent) {
        parents.unshift(matched.parent);
        getParents(matched.parent);
      }
    };
    getParents(matched);
    let lastResult: DOMilyMountableRender<any, any> | null = null;
    for (let i = 0; i < parents.length; i++) {
      if (i === 0) {
        lastResult = await this.prepareRouterView(
          parents[i]!,
          rootRouterView,
          groupKey
        );
      } else if (
        lastResult?.schema.__dom &&
        "querySelector" in lastResult.schema.__dom
      ) {
        const el = (
          lastResult.schema.__dom as HTMLElement
        ).querySelector<HTMLElement>(DomilyRouterView.name);
        if (el) {
          lastResult = await this.prepareRouterView(parents[i]!, el, groupKey);
        }
      }
    }
    return true;
  }

  unmountLastRouterViewGroup() {
    if (!this.GLobalPageRouterHistoryStoreMapLastKey) {
      return;
    }
    const lastItem = this.GLobalPageRouterHistoryStoreMap.get(
      this.GLobalPageRouterHistoryStoreMapLastKey
    );
    if (!lastItem?.length) {
      return;
    }
    lastItem.forEach((e) => e.comp.unmount());
  }

  match(pathname?: string): IMatchedRoute | null {
    pathname =
      pathname ||
      (this.mode === "history"
        ? globalThis.location.href.replace(globalThis.location.origin, "")
        : globalThis.location.hash.slice(1));
    const routesPathFlatMapExcludeWildcard = (() => {
      const value = {
        ...this.routesPathFlatMap,
      };
      if (value[wildcardPath]) {
        Reflect.deleteProperty(value, wildcardPath);
      }
      return value;
    })();
    const matched = matchRoute(
      Object.values(routesPathFlatMapExcludeWildcard),
      pathname
    );
    if (!matched) {
      const wildcard = this.routesPathMap[wildcardPath];
      return wildcard
        ? Object.assign(
            wildcard,
            generateFullUrl(pathname, {}, this.mode, this.base)
          )
        : null;
    }
    return Object.assign(
      matched,
      generateFullUrl(matched.path, matched, this.mode, this.base)
    );
  }

  matchPage(
    pathname?: string,
    callbacks?: {
      afterMatched?: (matched?: IMatchedRoute | null) => void;
      afterRendered?: (
        rendered: boolean,
        matched?: IMatchedRoute | null
      ) => void;
    }
  ) {
    const renderPromise = () =>
      new Promise<void>((resolve) => {
        const from = this.GLobalPageRouterHistoryStoreMapLastKey
          ? this.GLobalPageRouterHistoryStoreMap.get(
              this.GLobalPageRouterHistoryStoreMapLastKey
            )?.at(-1)
          : void 0;
        const matched = this.match(pathname);
        if (Array.isArray(this.beforeEach) && this.beforeEach.length) {
          for (const before of this.beforeEach) {
            if (ISUtils.isFunction(before)) {
              before(from, matched, (to) => {
                if (!to) {
                  this.currentRoute = matched;
                  return;
                }
                if (
                  typeof to === "object" &&
                  "render" in to &&
                  ISUtils.isFunction(to.render)
                ) {
                  this.currentRoute = to;
                  return;
                }
                if (typeof to === "string") {
                  this.currentRoute = this.resolve({ path: to });
                  return;
                }
                this.currentRoute = this.resolve(to);
              });
            }
          }
        } else {
          this.currentRoute = matched;
        }
        if (ISUtils.isFunction(callbacks?.afterMatched)) {
          callbacks.afterMatched(this.currentRoute);
        }
        this.unmountLastRouterViewGroup();
        this.GLobalPageRouterHistoryStoreMapLastKey = getGroupKey(
          this.currentRoute
        );
        this.deepRender(
          this.currentRoute,
          this.GLobalPageRouterHistoryStoreMapLastKey
        )
          .then((rendered) => {
            if (ISUtils.isFunction(callbacks?.afterRendered)) {
              callbacks.afterRendered(rendered, this.currentRoute);
            }
            if (
              rendered &&
              this.currentRoute &&
              this.currentRoute.href !== location.href
            ) {
              history.replaceState(
                this.obtainHistoryState(this.currentRoute),
                "",
                this.currentRoute.href
              );
            }
            if (Array.isArray(this.afterEach) && this.afterEach.length) {
              for (const after of this.afterEach) {
                if (ISUtils.isFunction(after)) {
                  after(this.currentRoute);
                }
              }
            }
          })
          .finally(resolve);
      });
    this.GLobalPageRouterRenderingQueue.push(renderPromise);
    this.executeQueueRender();
  }
  resolve(options: IRouterOptions): IMatchedRoute | null {
    const { name, path, query, params, hash } = options;
    const data = {
      query,
      params,
      hash,
    };
    const resolveFullPath = (routes?: { path: string }) => {
      const { fullPath, href } = routes
        ? generateFullUrl(routes.path, data, this.mode, this.base)
        : {};
      return {
        fullPath,
        href,
      };
    };
    if (name) {
      const routes = this.routesNameFlatMap[name];
      if (!routes) {
        return null;
      }
      return Object.assign(routes, data, resolveFullPath(routes));
    }
    if (path) {
      const routes = this.routesPathFlatMap[path];
      if (routes) {
        return Object.assign(routes, data, resolveFullPath(routes));
      }
      return this.match(path);
    }
    return null;
  }
  back() {
    history.back();
  }
  forward() {
    history.forward();
  }
  go(deep: number) {
    history.go(deep);
  }
  push(options: IRouterOptions | string) {
    if (typeof options === "string") {
      options = handleStringPathname(options);
    }
    const { href } = this.resolve(options) || {};
    if (!href) {
      return;
    }
    if (href === location.href) {
      return;
    }
    history.pushState(this.obtainHistoryState(options), "", href);
    this.matchPage();
  }
  replace(options: IRouterOptions | string) {
    if (typeof options === "string") {
      options = handleStringPathname(options);
    }
    const { href } = this.resolve(options) || {};
    if (!href) {
      return;
    }
    if (href === location.href) {
      return;
    }
    history.replaceState(this.obtainHistoryState(options), "", href);
    this.matchPage();
  }
}
