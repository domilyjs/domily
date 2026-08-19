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
  isPathWithinBase,
  type IMatchedRoute,
  matchRoute,
  normalizeBase,
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

const isWildcardPath = (path: string) => path === "*" || path === "/*";

const getGroupKey = (route?: IMatchedRoute | null) =>
  GroupKey.increase(route?.name || route?.path || "GROUP");

type AppMountedEvent = {
  namespace: string | symbol;
  root: HTMLElement | Document | ShadowRoot | undefined | null;
};

type AppDestroyedEvent = Pick<AppMountedEvent, "namespace">;

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
  ): void | Promise<void>;
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
  private activeNavigationId = 0;
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

  private getRoutePath(parentPath: string, path: string) {
    return combinePaths(parentPath, path);
  }

  private createRouteSnapshot(
    route: DomilyPageSchema<any>,
    path: string,
    parent: (DomilyPageSchema<any> & { parent?: DomilyPageSchema<any> | null }) | null
  ) {
    const snapshot = Object.assign(
      Object.create(Object.getPrototypeOf(route)),
      route,
      { path, parent }
    ) as DomilyPageSchema<any> & {
      parent?: DomilyPageSchema<any> | null;
    };
    snapshot.render = route.render.bind(route);
    return snapshot;
  }

  private getPathWithBase(path: string) {
    return isPathWithinBase(path, this.base)
      ? path
      : combinePaths(this.base, path);
  }
  /**
   * the router 'path' map
   */
  get routesPathMap() {
    return Object.fromEntries(
      this.routes.map((route) => {
        const path = this.getRoutePath(this.base, route.path);
        return [path, this.createRouteSnapshot(route, path, null)];
      })
    );
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
      parentPath: string,
      parent: (DomilyPageSchema<any> & {
        parent?: DomilyPageSchema<any> | null;
      }) | null = null
    ) => {
      routes.forEach((route) => {
        const path = this.getRoutePath(parentPath, route.path);
        const snapshot = this.createRouteSnapshot(route, path, parent);
        result[path] = snapshot;
        if (route.children) {
          getChildRoutes(route.children, path, snapshot);
        }
      });
    };
    getChildRoutes(this.routes, this.base);
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
      parentPath: string,
      parent: (DomilyPageSchema<any> & {
        parent?: DomilyPageSchema<any> | null;
      }) | null = null
    ) => {
      routes.forEach((route) => {
        const path = this.getRoutePath(parentPath, route.path);
        const snapshot = this.createRouteSnapshot(route, path, parent);
        result[route.name || path] = snapshot;
        if (route.children) {
          getChildRoutes(route.children, path, snapshot);
        }
      });
    };
    getChildRoutes(this.routes, this.base);
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
  private readonly onPageMounted = (page: IMatchedPage) => {
    const pageNamespace = page.namespace;
    if (pageNamespace !== this.app.namespace) {
      return;
    }
    if (!page.groupKey) {
      page.groupKey = getGroupKey(page);
    }
    const item = this.GLobalPageRouterHistoryStoreMap.get(page.groupKey);
    if (!item) {
      this.GLobalPageRouterHistoryStoreMap.set(page.groupKey, [page]);
    } else {
      this.GLobalPageRouterHistoryStoreMap.set(page.groupKey, [...item, page]);
    }
  };
  private readonly onAppMounted = (event: AppMountedEvent) => {
    if (event.namespace !== this.app.namespace) {
      return;
    }
    this.root = event.root;
    void this.matchPage();
  };
  private readonly onAppDestroyed = (event: AppDestroyedEvent) => {
    if (event.namespace === this.app.namespace) {
      this.destroy();
    }
  };
  private readonly onPopState = (e: PopStateEvent) => {
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
    void this.matchPage(fullPath, {
      afterRendered: (rendered) => {
        if (
          rendered &&
          Number.isFinite(pageXOffset) &&
          Number.isFinite(pageYOffset) &&
          typeof globalThis.scrollTo === "function"
        ) {
          globalThis.scrollTo(pageXOffset, pageYOffset);
        }
      },
    });
  };

  constructor(app: DomilyApp, options?: ICreateRouterOptions) {
    const { routes, base = "/", mode = "hash" } = options || {};
    this.base = normalizeBase(base);
    this.app = app;
    this.mode = mode;
    this.routes =
      routes?.map((route) =>
        DomilyPageSchema.create({
          ...route,
          namespace: route.namespace ?? app.namespace,
          path: removeEndSlash(route.path),
        })
      ) || [];
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
    EventBus.on<IMatchedPage>(ROUTER_EVENTS.PAGE_MOUNTED, this.onPageMounted);

    this.initRouter();
    EventBus.on<AppMountedEvent>(EVENTS.APP_MOUNTED, this.onAppMounted);
    EventBus.on<AppDestroyedEvent>(EVENTS.APP_DESTROYED, this.onAppDestroyed);
    if (this.mode === "history") {
      globalThis.addEventListener("popstate", this.onPopState);
    }
    this.initialed = true;
  }

  destroy() {
    this.activeNavigationId++;
    EventBus.off(ROUTER_EVENTS.PAGE_MOUNTED, this.onPageMounted);
    EventBus.off(EVENTS.APP_MOUNTED, this.onAppMounted);
    EventBus.off(EVENTS.APP_DESTROYED, this.onAppDestroyed);
    globalThis.removeEventListener("popstate", this.onPopState);
    this.GLobalPageRouterRenderingQueue = [];
    this.GLobalPageRouterHistoryStoreMap.clear();
    this.GLobalPageRouterHistoryStoreMapLastKey = undefined;
    this.root = null;
    this.currentRoute = null;
    this.initialed = false;
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
    let firstError: unknown;
    try {
      while (this.GLobalPageRouterRenderingQueue.length) {
        const promise = this.GLobalPageRouterRenderingQueue.shift();
        if (typeof promise === "function") {
          try {
            await promise();
          } catch (error) {
            firstError ??= error;
          }
        }
      }
    } finally {
      this.GLobalPageRouterRendering = false;
    }
    if (firstError) {
      throw firstError;
    }
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

  private followRedirect(route: IMatchedRoute | null) {
    const visited = new Set<string>();
    let current = route;
    while (current?.redirect) {
      const identity = current.name || current.path;
      if (visited.has(identity)) {
        throw new Error(`Domily router redirect cycle detected at ${identity}.`);
      }
      visited.add(identity);

      const { name, path } = current.redirect;
      const target = name
        ? this.routesNameFlatMap[name]
        : path
        ? this.routesPathFlatMap[this.getPathWithBase(path)]
        : null;
      current = target
        ? Object.assign(
            Object.create(Object.getPrototypeOf(target)),
            target,
            generateFullUrl(target.path, undefined, this.mode, this.base)
          )
        : null;
    }
    return current;
  }

  match(pathname?: string): IMatchedRoute | null {
    const requestedPath =
      pathname ||
      (this.mode === "history"
        ? globalThis.location.href.replace(globalThis.location.origin, "")
        : globalThis.location.hash.slice(1));
    const path = this.getPathWithBase(requestedPath);
    const matched = matchRoute(this.routes, path, this.base);
    if (!matched) {
      const wildcard = this.routes.find((route) => isWildcardPath(route.path));
      return wildcard
        ? Object.assign(
            this.createRouteSnapshot(
              wildcard,
              this.getRoutePath(this.base, wildcard.path),
              null
            ),
            generateFullUrl(path, {}, this.mode, this.base)
          )
        : null;
    }
    return this.followRedirect(Object.assign(
      matched,
      generateFullUrl(matched.path, matched, this.mode, this.base)
    ));
  }

  private resolveGuardTarget(
    target: IRouterOptions | IMatchedPage | IMatchedRoute | string | undefined,
    fallback: IMatchedRoute | null
  ) {
    if (!target) {
      return fallback;
    }
    if (
      typeof target === "object" &&
      "render" in target &&
      ISUtils.isFunction(target.render)
    ) {
      return target;
    }
    if (typeof target === "string") {
      return this.resolve({ path: target });
    }
    return this.resolve(target);
  }

  private async runBeforeEach(
    from: IMatchedPage | undefined,
    initialTarget: IMatchedRoute | null
  ) {
    let target = initialTarget;
    for (const before of this.beforeEach) {
      if (!ISUtils.isFunction(before)) {
        continue;
      }

      let called = false;
      let resolveNext: (
        target?: IRouterOptions | IMatchedPage | IMatchedRoute | string
      ) => void = () => {};
      const nextResult = new Promise<
        IRouterOptions | IMatchedPage | IMatchedRoute | string | undefined
      >((resolve) => {
        resolveNext = resolve;
      });
      const next = (
        nextTarget?: IRouterOptions | IMatchedPage | IMatchedRoute | string
      ) => {
        if (!called) {
          called = true;
          resolveNext(nextTarget);
        }
      };

      const result = before(from, target, next);
      if (result && typeof result === "object" && "then" in result) {
        await result;
      }
      if (!called && before.length < 3) {
        next();
      }

      target = this.resolveGuardTarget(await nextResult, target);
    }
    return target;
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
    const navigationId = ++this.activeNavigationId;
    let resolveCompletion: () => void = () => {};
    let rejectCompletion: (reason?: unknown) => void = () => {};
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const renderPromise = async () => {
      try {
        const from = this.GLobalPageRouterHistoryStoreMapLastKey
          ? this.GLobalPageRouterHistoryStoreMap.get(
              this.GLobalPageRouterHistoryStoreMapLastKey
            )?.at(-1)
          : void 0;
        const matched = this.match(pathname);
        const nextRoute = await this.runBeforeEach(from, matched);
        if (navigationId !== this.activeNavigationId) {
          resolveCompletion();
          return;
        }
        this.currentRoute = nextRoute;
        if (ISUtils.isFunction(callbacks?.afterMatched)) {
          callbacks.afterMatched(this.currentRoute);
        }
        this.unmountLastRouterViewGroup();
        this.GLobalPageRouterHistoryStoreMapLastKey = getGroupKey(
          this.currentRoute
        );
        const rendered = await this.deepRender(
          this.currentRoute,
          this.GLobalPageRouterHistoryStoreMapLastKey
        );
        if (navigationId !== this.activeNavigationId) {
          resolveCompletion();
          return;
        }
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
        resolveCompletion();
      } catch (error) {
        rejectCompletion(error);
        throw error;
      }
    };
    this.GLobalPageRouterRenderingQueue.push(renderPromise);
    void this.executeQueueRender().catch(() => {});
    void completion.catch(() => {});
    return completion;
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
      const routes = this.routesPathFlatMap[this.getPathWithBase(path)];
      if (routes) {
        return Object.assign(routes, data, resolveFullPath(routes));
      }
      return this.match(this.getPathWithBase(path));
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
