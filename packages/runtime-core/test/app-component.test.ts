import { describe, expect, test } from "bun:test";

class TestHTMLElement {
  attributes: Array<{ name: string; value: string }> = [];
  isConnected = false;
}
class TestNode {}

Object.assign(globalThis, {
  HTMLElement: TestHTMLElement,
  Node: TestNode,
});

const { default: DomilyApp, inject, provide } = await import(
  "../src/core/app/index"
);
const { parseComponent } = await import("../src/core/component/index");
const { EventBus, EVENTS } = await import("../src/utils/event-bus");

describe("app injection", () => {
  test("returns falsy providers instead of falling back to the default", () => {
    const namespace = Symbol("injection-test");
    const app = new DomilyApp(() => ({ tag: "div" }), { namespace });

    provide("enabled", false, namespace);
    provide("count", 0, namespace);
    provide("label", "", namespace);
    provide(1, "one", namespace);

    expect(inject("enabled", true, namespace)).toBe(false);
    expect(inject("count", 1, namespace)).toBe(0);
    expect(inject("label", "fallback", namespace)).toBe("");
    expect(inject(1, "fallback", namespace)).toBe("one");

    let destroyedNamespace: string | symbol | undefined;
    EventBus.once<{ namespace: string | symbol }>(
      EVENTS.APP_DESTROYED,
      (event) => {
        destroyedNamespace = event.namespace;
      }
    );
    app.destroy();

    expect(destroyedNamespace).toBe(namespace);
  });
});

describe("components", () => {
  test("creates an independent mountable for each component occurrence", () => {
    const Component = () => ({ tag: "div", text: "item" });

    const first = parseComponent({}, Component);
    const second = parseComponent({}, Component);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(first?.schema).not.toBe(second?.schema);
  });
});

describe("custom elements", () => {
  test("replaces its active mountable when attributes change and disposes it on disconnect", () => {
    const definitions = new Map<string, CustomElementConstructor>();
    Object.assign(globalThis, {
      customElements: {
        define(name: string, constructor: CustomElementConstructor) {
          definitions.set(name, constructor);
        },
        get(name: string) {
          return definitions.get(name);
        },
      },
    });

    const namespace = Symbol("custom-element-test");
    const app = new DomilyApp(() => ({ tag: "div" }), { namespace });
    const mounted: Array<{ mount: number; unmount: number }> = [];
    const Component = () => {
      const counters = { mount: 0, unmount: 0 };
      mounted.push(counters);
      const schema = {
        tag: "div",
        __dom: { replaceWith() {} },
        render() {
          return this.__dom;
        },
      };
      return {
        schema,
        mount() {
          counters.mount += 1;
        },
        unmount() {
          counters.unmount += 1;
        },
      } as any;
    };

    app.defineCustomElement("status-card", Component, {
      observedAttributes: ["status"],
    });
    const StatusCard = definitions.get("status-card");
    expect(StatusCard).toBeDefined();

    const element = new (StatusCard as CustomElementConstructor)() as unknown as TestHTMLElement & {
      connectedCallback(): void;
      disconnectedCallback(): void;
      attributeChangedCallback(): void;
    };
    element.isConnected = true;
    element.connectedCallback();
    element.attributeChangedCallback();
    element.disconnectedCallback();

    expect(mounted).toHaveLength(2);
    expect(mounted[0]).toEqual({ mount: 1, unmount: 1 });
    expect(mounted[1]).toEqual({ mount: 1, unmount: 1 });

    app.destroy();
  });
});
