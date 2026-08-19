import {
  getCurrentInstance,
  type DomilyApp,
  type DOMilyPlugin,
} from "@domily/runtime-core";
import DomilyRouterBase, {
  type ICreateRouterOptions,
  type IRouterAfterEach,
  type IRouterBeforeEach,
} from "./base";
import DomilyHashRouter from "./hash";
import DomilyHistoryRouter from "./history";

export * from "./page";
export * from "./event";
export { default as DomilyPageSchema } from "./page";

export interface DOMilyRouterHelper {
  push: DomilyRouterBase["push"];
  replace: DomilyRouterBase["replace"];
  resolve: DomilyRouterBase["resolve"];
  back: DomilyRouterBase["back"];
  forward: DomilyRouterBase["forward"];
  go: DomilyRouterBase["go"];
  destroy: DomilyRouterBase["destroy"];
  routes: DomilyRouterBase["routes"];
  currentRoute: DomilyRouterBase["currentRoute"];
}

export interface DOMilyRouterHooks extends DOMilyRouterHelper {
  beforeEach(callback: IRouterBeforeEach): void;
  afterEach(callback: IRouterAfterEach): void;
}

export type DOMilyRouterPlugin = DOMilyPlugin<DOMilyRouterHooks>;

function injectBaseHelperToPlugin(
  plugin: DOMilyRouterPlugin,
  router: DomilyRouterBase
) {
  const DomilyRouterHelperKeys = [
    "push",
    "replace",
    "resolve",
    "back",
    "forward",
    "go",
    "destroy",
    "routes",
    "currentRoute",
  ] as const;
  DomilyRouterHelperKeys.forEach((key) => {
    if (!plugin[key]) {
      Reflect.defineProperty(plugin, key, {
        get() {
          const value = Reflect.get(router, key, router);
          if (typeof value === "function") {
            return value.bind(router);
          }
          return value;
        },
      });
    }
  });
  return router;
}

export function createHistoryRouter(
  option?: ICreateRouterOptions
): DOMilyRouterPlugin {
  const beforeEach: IRouterBeforeEach[] = [];
  const afterEach: IRouterAfterEach[] = [];
  const plugin = {
    install: (app: DomilyApp) => {
      const router = new DomilyHistoryRouter(app, option);
      router.beforeEach = beforeEach;
      router.afterEach = afterEach;
      injectBaseHelperToPlugin(plugin, router);
    },
    beforeEach(callback: IRouterBeforeEach) {
      if (!beforeEach.includes(callback)) {
        beforeEach.push(callback);
      }
    },
    afterEach(callback: IRouterAfterEach) {
      if (!afterEach.includes(callback)) {
        afterEach.push(callback);
      }
    },
  } as DOMilyRouterPlugin;
  return plugin;
}

export function createHashRouter(
  option?: ICreateRouterOptions
): DOMilyRouterPlugin {
  const beforeEach: IRouterBeforeEach[] = [];
  const afterEach: IRouterAfterEach[] = [];
  const plugin = {
    install: (app: DomilyApp) => {
      const router = new DomilyHashRouter(app, option);
      router.beforeEach = beforeEach;
      router.afterEach = afterEach;
      injectBaseHelperToPlugin(plugin, router);
    },
    beforeEach(callback: IRouterBeforeEach) {
      if (!beforeEach.includes(callback)) {
        beforeEach.push(callback);
      }
    },
    afterEach(callback: IRouterAfterEach) {
      if (!afterEach.includes(callback)) {
        afterEach.push(callback);
      }
    },
  } as DOMilyRouterPlugin;
  return plugin;
}

export function useRouter(namespace?: string | symbol): DOMilyRouterHelper {
  const app = getCurrentInstance(namespace);
  if (!app) {
    throw new Error(`the useRouter must be used by a domily app`);
  }
  return app.globalProperties["$router"];
}

export function useRoute(
  namespace?: string | symbol
): DomilyRouterBase["currentRoute"] {
  const app = getCurrentInstance(namespace);
  if (!app) {
    return;
  }
  return app.globalProperties["$route"];
}

export const DomilyRouter = {
  DomilyRouterBase,
  DomilyHashRouter,
  DomilyHistoryRouter,
  createHistoryRouter,
  createHashRouter,
  useRouter,
  useRoute,
};

export interface IRouterGlobalProperties {
  $router: DomilyRouterBase;
  $route: DomilyRouterBase["currentRoute"];
}

if (!Reflect.get(globalThis, "DomilyRouter")) {
  Reflect.defineProperty(globalThis, "DomilyRouter", {
    value: DomilyRouter,
  });
}
