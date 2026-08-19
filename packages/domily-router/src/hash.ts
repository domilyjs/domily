import type { DomilyApp } from "@domily/runtime-core";
import DomilyRouterBase, { type ICreateRouterOptions } from "./base";

const hashChangeListeners = new WeakMap<DomilyHashRouter, EventListener>();

export default class DomilyHashRouter extends DomilyRouterBase {
  constructor(app: DomilyApp, options?: Omit<ICreateRouterOptions, "mode">) {
    super(app, {
      ...options,
      mode: "hash" as const,
    });
    Reflect.set(this.app.globalProperties, "$router", this);
    Reflect.defineProperty(this.app.globalProperties, "$route", {
      get: () => {
        return this.currentRoute;
      },
    });
  }
  initRouter() {
    if (!globalThis.location.hash) {
      globalThis.location.hash = `#${this.base}`;
    }
    const listener = () => {
      void this.matchPage();
    };
    hashChangeListeners.set(this, listener);
    globalThis.addEventListener("hashchange", listener);
  }

  override destroy() {
    const listener = hashChangeListeners.get(this);
    if (listener) {
      globalThis.removeEventListener("hashchange", listener);
      hashChangeListeners.delete(this);
    }
    super.destroy();
  }
}
