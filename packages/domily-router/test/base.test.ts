import { describe, expect, mock, test } from "bun:test";

const busListeners = new Map<string, Set<(value: unknown) => void>>();

mock.module("@domily/runtime-core", () => ({
  DomilyApp: class {},
  DomilyRouterView: { name: "router-view" },
  DomilyAppInstances: new Map(),
  EB: {
    EventBus: {
      emit(event: string, value: unknown) {
        for (const listener of busListeners.get(event) ?? []) {
          listener(value);
        }
      },
      on(event: string, listener: (value: unknown) => void) {
        const listeners = busListeners.get(event) ?? new Set();
        listeners.add(listener);
        busListeners.set(event, listeners);
      },
      off(event: string, listener?: (value: unknown) => void) {
        if (!listener) {
          busListeners.delete(event);
          return;
        }
        busListeners.get(event)?.delete(listener);
      },
    },
    EVENTS: {
      APP_MOUNTED: "app-mounted",
      APP_DESTROYED: "app-destroyed",
    },
  },
  ISUtils: {
    isFunction: (value: unknown) => typeof value === "function",
    isThenable: (value: unknown) =>
      Boolean(value && typeof (value as { then?: unknown }).then === "function"),
  },
  parseComponent: () => null,
}));

const eventListeners = new Map<string, Set<(event: PopStateEvent) => void>>();
Reflect.defineProperty(globalThis, "addEventListener", {
  configurable: true,
  value: (type: string, listener: (event: PopStateEvent) => void) => {
    const listeners = eventListeners.get(type) ?? new Set();
    listeners.add(listener);
    eventListeners.set(type, listeners);
  },
});
Reflect.defineProperty(globalThis, "removeEventListener", {
  configurable: true,
  value: (type: string, listener: (event: PopStateEvent) => void) => {
    eventListeners.get(type)?.delete(listener);
  },
});
Reflect.defineProperty(globalThis, "location", {
  configurable: true,
  value: new URL("https://domily.test/app/account/users/42"),
});

describe("DomilyRouterBase", () => {
  test("keeps caller routes immutable and resolves nested names with their full path", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");

    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }

    const routes = [
      {
        name: "account",
        path: "/account",
        children: [
          {
            name: "account-user",
            path: "users/:id",
          },
        ],
      },
      {
        name: "not-found",
        path: "*",
      },
    ];
    const original = structuredClone(routes);
    const app = {
      namespace: "router-test",
      globalProperties: {},
    };
    const router = new TestRouter(app as never, {
      base: "/app",
      mode: "history",
      routes,
    });

    expect(routes).toEqual(original);
    expect(router.match("/app/account/users/42")).toMatchObject({
      name: "account-user",
      path: "/app/account/users/:id",
      params: { id: "42" },
    });
    expect(router.match("/app/users/42")).toMatchObject({
      name: "not-found",
      path: "/app/*",
    });
    expect(
      router.resolve({ name: "account-user", params: { id: "42" } })
    ).toMatchObject({
      fullPath: "/app/account/users/42",
      href: "https://domily.test/app/account/users/42",
    });

    router.GLobalPageRouterRenderingQueue.push(async () => {
      throw new Error("render failed");
    });
    await expect(router.executeQueueRender()).rejects.toThrow("render failed");
    expect(router.GLobalPageRouterRendering).toBeFalse();
  });

  test("restores popstate scroll positions through scrollTo", async () => {
    let restored: [number, number] | undefined;
    Reflect.defineProperty(globalThis, "scrollTo", {
      configurable: true,
      value: (x: number, y: number) => {
        restored = [x, y];
      },
    });

    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "scroll-router", globalProperties: {} } as never,
      { mode: "history", routes: [{ path: "/destination" }] }
    );
    router.matchPage = (_pathname, callbacks) => {
      callbacks?.afterRendered?.(true, null);
      return Promise.resolve();
    };

    [...(eventListeners.get("popstate") ?? [])].at(-1)?.({
      state: { path: "/destination", x: 10, y: 20 },
    } as PopStateEvent);

    expect(restored).toEqual([10, 20]);
  });

  test("isolates app events by namespace and removes listeners on destroy", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");
    const { EB } = await import("@domily/runtime-core");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const first = new TestRouter(
      { namespace: "first-router", globalProperties: {} } as never,
      { mode: "history", routes: [{ path: "/" }] }
    );
    const second = new TestRouter(
      { namespace: "second-router", globalProperties: {} } as never,
      { mode: "history", routes: [{ path: "/" }] }
    );
    const firstRoot = { querySelector() {} } as unknown as HTMLElement;
    const secondRoot = { querySelector() {} } as unknown as HTMLElement;

    EB.EventBus.emit("app-mounted", {
      namespace: "first-router",
      root: firstRoot,
    });
    expect(first.root).toBe(firstRoot);
    expect(second.root).toBeNull();

    first.destroy();
    EB.EventBus.emit("app-mounted", {
      namespace: "first-router",
      root: secondRoot,
    });
    expect(first.root).toBeNull();

    EB.EventBus.emit("app-destroyed", { namespace: "second-router" });
    expect(second.initialed).toBeFalse();
  });

  test("initializes hash routing at its configured base", async () => {
    Reflect.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://domily.test/"),
    });
    const { default: DomilyHashRouter } = await import("../src/hash");

    new DomilyHashRouter(
      { namespace: "hash-router", globalProperties: {} } as never,
      { base: "/app", routes: [{ path: "/" }] }
    );

    expect(globalThis.location.hash).toBe("#/app");
  });

  test("uses hashchange instead of a second popstate listener", async () => {
    Reflect.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://domily.test/#/"),
    });
    const { default: DomilyHashRouter } = await import("../src/hash");
    const popStateListenersBefore = eventListeners.get("popstate")?.size ?? 0;
    const router = new DomilyHashRouter(
      { namespace: "hash-event-router", globalProperties: {} } as never,
      { routes: [{ path: "/" }] }
    );
    let navigations = 0;
    router.matchPage = () => {
      navigations += 1;
      return Promise.resolve();
    };

    [...(eventListeners.get("hashchange") ?? [])].at(-1)?.({} as PopStateEvent);

    expect(navigations).toBe(1);
    expect(eventListeners.get("popstate")?.size ?? 0).toBe(
      popStateListenersBefore
    );
    router.destroy();
  });

  test("waits for asynchronous guards before rendering their redirect target", async () => {
    Reflect.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://domily.test/"),
    });
    Reflect.defineProperty(globalThis, "history", {
      configurable: true,
      value: { replaceState() {} },
    });
    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "guard-router", globalProperties: {} } as never,
      {
        mode: "history",
        routes: [
          { name: "secure", path: "/secure" },
          { name: "login", path: "/login" },
        ],
      }
    );
    const rendered: string[] = [];
    router.deepRender = async (route) => {
      if (route?.path) {
        rendered.push(route.path);
      }
      return true;
    };
    router.beforeEach.push((_from, _to, next) => {
      setTimeout(() => next("/login"), 0);
    });

    await router.matchPage("/secure");

    expect(router.currentRoute?.path).toBe("/login");
    expect(rendered).toEqual(["/login"]);
  });

  test("does not render a stale navigation after a newer request arrives", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "stale-navigation-router", globalProperties: {} } as never,
      {
        mode: "history",
        routes: [{ path: "/slow" }, { path: "/fast" }],
      }
    );
    let releaseSlowGuard: (() => void) | undefined;
    const rendered: string[] = [];
    router.beforeEach.push((_from, to, next) => {
      if (to?.path === "/slow") {
        setTimeout(() => {
          releaseSlowGuard = () => next();
        }, 0);
        return;
      }
      next();
    });
    router.deepRender = async (route) => {
      if (route?.path) {
        rendered.push(route.path);
      }
      return true;
    };

    const slow = router.matchPage("/slow");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fast = router.matchPage("/fast");
    releaseSlowGuard?.();
    await Promise.all([slow, fast]);

    expect(rendered).toEqual(["/fast"]);
  });

  test("cancels an in-flight navigation when the router is destroyed", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "destroy-navigation-router", globalProperties: {} } as never,
      { mode: "history", routes: [{ path: "/slow" }] }
    );
    let releaseGuard: (() => void) | undefined;
    const guardStarted = Promise.withResolvers<void>();
    let renders = 0;
    router.beforeEach.push((_from, _to, next) => {
      releaseGuard = next;
      guardStarted.resolve();
    });
    router.deepRender = async () => {
      renders += 1;
      return true;
    };

    const navigation = router.matchPage("/slow");
    await guardStarted.promise;
    router.destroy();
    releaseGuard?.();
    await navigation;

    expect(router.currentRoute).toBeNull();
    expect(renders).toBe(0);
  });

  test("recovers its render queue after a guard throws", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "queue-router", globalProperties: {} } as never,
      { mode: "history", routes: [{ path: "/first" }, { path: "/second" }] }
    );
    const rendered: string[] = [];
    router.deepRender = async (route) => {
      if (route?.path) {
        rendered.push(route.path);
      }
      return true;
    };
    router.beforeEach.push(() => {
      throw new Error("guard failed");
    });

    await expect(router.matchPage("/first")).rejects.toThrow("guard failed");
    expect(router.GLobalPageRouterRendering).toBeFalse();

    router.beforeEach = [];
    await router.matchPage("/second");

    expect(rendered).toEqual(["/second"]);
  });

  test("resolves redirects before guards and rendering use the route", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "redirect-router", globalProperties: {} } as never,
      {
        mode: "history",
        routes: [
          { name: "legacy", path: "/legacy", redirect: { path: "/home" } },
          { name: "home", path: "/home" },
        ],
      }
    );
    const guarded: string[] = [];
    const rendered: string[] = [];
    router.beforeEach.push((_from, to, next) => {
      guarded.push(to?.path ?? "");
      next();
    });
    router.deepRender = async (route) => {
      if (route?.path) {
        rendered.push(route.path);
      }
      return true;
    };

    await router.matchPage("/legacy");

    expect(router.currentRoute?.path).toBe("/home");
    expect(guarded).toEqual(["/home"]);
    expect(rendered).toEqual(["/home"]);
  });

  test("rejects redirect cycles instead of recursing indefinitely", async () => {
    const { default: DomilyRouterBase } = await import("../src/base");
    class TestRouter extends DomilyRouterBase {
      initRouter() {}
    }
    const router = new TestRouter(
      { namespace: "redirect-cycle-router", globalProperties: {} } as never,
      {
        mode: "history",
        routes: [
          { name: "first", path: "/first", redirect: { name: "second" } },
          { name: "second", path: "/second", redirect: { name: "first" } },
        ],
      }
    );

    expect(() => router.match("/first")).toThrow("redirect cycle");
  });
});
