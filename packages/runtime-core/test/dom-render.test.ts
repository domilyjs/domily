import { describe, expect, test } from "bun:test";
import { signal } from "alien-signals";

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  isConnected = false;
  nodeName = "#node";

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  append(...nodes: (TestNode | string)[]) {
    for (const node of nodes) {
      this.appendChild(
        typeof node === "string" ? new TestText(node) : node
      );
    }
  }

  appendChild(node: TestNode): TestNode {
    if (node instanceof TestDocumentFragment) {
      while (node.firstChild) {
        this.appendChild(node.firstChild);
      }
      return node;
    }
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    node.setConnected(this.isConnected);
    return node;
  }

  prepend(node: TestNode) {
    node.remove();
    node.parentNode = this;
    this.childNodes.unshift(node);
    node.setConnected(this.isConnected);
  }

  insertBefore(node: TestNode, reference: TestNode | null): TestNode {
    if (!reference) {
      return this.appendChild(node);
    }
    const index = this.childNodes.indexOf(reference);
    if (index < 0) {
      return this.appendChild(node);
    }
    node.remove();
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
    node.setConnected(this.isConnected);
    return node;
  }

  removeChild(node: TestNode) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
      node.setConnected(false);
    }
    return node;
  }

  replaceChild(next: TestNode, current: TestNode) {
    const index = this.childNodes.indexOf(current);
    if (index < 0) {
      throw new Error("Current child does not belong to this parent");
    }
    next.remove();
    current.parentNode = null;
    current.setConnected(false);
    next.parentNode = this;
    next.setConnected(this.isConnected);
    this.childNodes.splice(index, 1, next);
    return current;
  }

  replaceWith(next: TestNode) {
    this.parentNode?.replaceChild(next, this);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setConnected(connected: boolean) {
    this.isConnected = connected;
    for (const child of this.childNodes) {
      child.setConnected(connected);
    }
  }
}

class TestText extends TestNode {
  nodeName = "#text";

  constructor(public data = "") {
    super();
  }
}

class TestComment extends TestText {
  nodeName = "#comment";
}

class TestDocumentFragment extends TestNode {
  nodeName = "#document-fragment";
}

type TestListener = EventListenerOrEventListenerObject;

class TestHTMLElement extends TestNode {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style = {
    cssText: "",
    setProperty: (_property: string, _value: string | null) => {},
  };
  readonly listeners = new Map<string, TestListener[]>();
  className = "";
  innerHTML = "";
  private text = "";
  tagName: string;

  constructor(tagName = "div") {
    super();
    this.tagName = tagName;
  }

  get innerText() {
    return this.text;
  }

  set innerText(value: unknown) {
    this.text = String(value);
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  addEventListener(
    type: string,
    listener: TestListener,
    options?: boolean | AddEventListenerOptions
  ) {
    const listeners = this.listeners.get(type) ?? [];
    const signal = typeof options === "object" ? options.signal : undefined;
    if (signal?.aborted) {
      return;
    }
    listeners.push(listener);
    this.listeners.set(type, listeners);
    signal?.addEventListener("abort", () => {
      const registered = this.listeners.get(type);
      if (!registered) {
        return;
      }
      this.listeners.set(
        type,
        registered.filter((candidate) => candidate !== listener)
      );
    });
  }

  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
    return true;
  }
}

class TestDocument extends TestNode {
  readonly body = new TestHTMLElement("body");
  readonly head = new TestHTMLElement("head");
  readonly documentElement = new TestHTMLElement("html");

  constructor() {
    super();
    this.setConnected(true);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string) {
    return new TestHTMLElement(tagName);
  }

  createElementNS(_namespace: string, tagName: string) {
    return new TestHTMLElement(tagName);
  }

  createTextNode(data: string) {
    return new TestText(data);
  }

  createComment(data: string) {
    return new TestComment(data);
  }

  createDocumentFragment() {
    return new TestDocumentFragment();
  }

  importNode(node: TestNode) {
    return node;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

const document = new TestDocument();
const customElements = {
  registry: new Map<string, CustomElementConstructor>(),
  define(name: string, constructor: CustomElementConstructor) {
    this.registry.set(name, constructor);
  },
  get(name: string) {
    return this.registry.get(name);
  },
};

Object.assign(globalThis, {
  HTMLElement: TestHTMLElement,
  Node: TestNode,
  document,
  customElements,
});

const { default: DomilyRenderSchema } = await import(
  "../src/core/render/schema"
);
const { mountable } = await import("../src/utils/dom");

async function flushLifecycle() {
  await Promise.resolve();
  await Promise.resolve();
}

function testRoot() {
  const root = new TestHTMLElement("main");
  document.body.appendChild(root);
  return root;
}

describe("DOM rendering", () => {
  test("renders numeric text content", () => {
    const schema = new DomilyRenderSchema({ tag: "div", text: 0 });
    const dom = schema.render() as unknown as TestHTMLElement;

    expect(dom.innerText).toBe("0");
  });

  test("attaches EventListenerObject handlers", () => {
    let calls = 0;
    const listener: EventListenerObject = {
      handleEvent() {
        calls += 1;
      },
    };
    const schema = new DomilyRenderSchema({
      tag: "button",
      on: { click: listener },
    });
    const dom = schema.render() as unknown as TestHTMLElement;

    dom.dispatchEvent(new Event("click"));

    expect(calls).toBe(1);
  });

  test("does not attach an event when the caller signal was already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const schema = new DomilyRenderSchema({
      tag: "button",
      on: {
        click: {
          event: () => {
            calls += 1;
          },
          option: { signal: controller.signal },
        },
      },
    });
    const dom = schema.render() as unknown as TestHTMLElement;

    dom.dispatchEvent(new Event("click"));

    expect(calls).toBe(0);
  });

  test("removes props and attributes that disappear from reactive records", () => {
    const props = signal<Record<string, string>>({ title: "first" });
    const attrs = signal<Record<string, string>>({ "data-state": "first" });
    const schema = new DomilyRenderSchema({
      tag: "div",
      props: () => props(),
      attrs: () => attrs(),
    });
    const dom = schema.render() as unknown as TestHTMLElement & {
      title?: string;
    };

    props({});
    attrs({});

    expect(dom.title).toBeUndefined();
    expect(dom.attributes.has("data-state")).toBe(false);
  });

  test("inserts CSS when a reactive CSS value becomes available", () => {
    const css = signal("");
    const schema = new DomilyRenderSchema({
      tag: "div",
      css: () => css(),
    });
    const dom = schema.render() as unknown as TestHTMLElement;

    css(".item { color: red; }");

    expect((dom.childNodes[0] as TestHTMLElement).tagName).toBe("style");
  });

  test("reconciles domIf before a detached schema is mounted", async () => {
    const visible = signal(false);
    const schema = new DomilyRenderSchema({
      tag: "div",
      text: "visible",
      domIf: () => visible(),
    });
    const initialDOM = schema.render();

    expect(initialDOM?.nodeName).toBe("#comment");

    visible(true);
    await flushLifecycle();

    const render = mountable(schema);
    const root = testRoot();
    render.mount(root as unknown as HTMLElement);
    await flushLifecycle();

    expect((schema.__dom as unknown as TestHTMLElement).tagName).toBe("div");
    expect(root.firstChild).toBe(schema.__dom as unknown as TestNode);
  });

  test("preserves zero as a valid keyed DOM identity", () => {
    const schema = new DomilyRenderSchema({ tag: "div", key: 0 });
    const dom = schema.render() as unknown as Record<PropertyKey, unknown>;

    const key = Reflect.ownKeys(dom).find(
      (candidate) =>
        typeof candidate === "symbol" &&
        candidate.description === "___DOMILY_LIST_MAP_KEY___"
    );
    expect(key).toBeDefined();
    expect(key && dom[key]).toBe(0);
  });

  test("unmount stops schema effects and event listeners before removing DOM", async () => {
    const text = signal("before");
    let clicks = 0;
    let updates = 0;
    const schema = new DomilyRenderSchema({
      tag: "button",
      text: () => text(),
      on: { click: () => (clicks += 1) },
      updated: () => (updates += 1),
    });
    const render = mountable(schema);
    const root = testRoot();

    render.mount(root as unknown as HTMLElement);
    await flushLifecycle();
    const dom = schema.__dom as unknown as TestHTMLElement;
    const initialUpdates = updates;

    render.unmount();
    await flushLifecycle();
    text("after");
    dom.dispatchEvent(new Event("click"));

    expect(schema.__dom).toBeNull();
    expect(dom.parentNode).toBeNull();
    expect(dom.innerText).toBe("before");
    expect(clicks).toBe(0);
    expect(updates).toBe(initialUpdates);
  });

  test("keeps an asynchronous unmount bound to the children it started with", async () => {
    const lifecycle: string[] = [];
    let renderId = 0;
    let firstUnmountId: number | undefined;
    let releaseFirstUnmount: (() => void) | undefined;
    const schema = new DomilyRenderSchema({
      tag: "div",
      children: [
        () => {
          const id = ++renderId;
          return {
            tag: "span",
            beforeUnmount: () =>
              firstUnmountId === undefined
                ? new Promise<void>((resolve) => {
                    firstUnmountId = id;
                    releaseFirstUnmount = resolve;
                  })
                : undefined,
            unmounted: () => lifecycle.push(`child-${id}:unmounted`),
          };
        },
      ],
    });
    const render = mountable(schema);

    render.mount(testRoot() as unknown as HTMLElement);
    await flushLifecycle();
    render.unmount();
    render.mount(testRoot() as unknown as HTMLElement);
    await flushLifecycle();
    releaseFirstUnmount?.();
    await flushLifecycle();

    expect(lifecycle).toEqual([`child-${firstUnmountId}:unmounted`]);
  });

  test("replaces mapList children without retaining their effects or lifecycle", async () => {
    const list = signal(["old"]);
    const oldText = signal("old text");
    const lifecycle: string[] = [];
    let oldUpdates = 0;
    const schema = new DomilyRenderSchema({
      tag: "div",
      mapList: {
        list: () => list(),
        map: (item) =>
          item === "old"
            ? {
                tag: "span",
                text: () => oldText(),
                beforeMount: () => {
                  lifecycle.push("old:beforeMount");
                },
                mounted: () => {
                  lifecycle.push("old:mounted");
                },
                beforeUnmount: () => {
                  lifecycle.push("old:beforeUnmount");
                },
                unmounted: () => {
                  lifecycle.push("old:unmounted");
                },
                updated: () => {
                  oldUpdates += 1;
                },
              }
            : {
                tag: "span",
                text: item,
                beforeMount: () => {
                  lifecycle.push("new:beforeMount");
                },
                mounted: () => {
                  lifecycle.push("new:mounted");
                },
              },
      },
    });
    const render = mountable(schema);

    render.mount(testRoot() as unknown as HTMLElement);
    await flushLifecycle();
    const oldDOM = (schema.__dom as unknown as TestHTMLElement).childNodes[
      0
    ] as TestHTMLElement;

    list(["new"]);
    await flushLifecycle();
    oldText("should not update removed child");
    await flushLifecycle();

    expect(oldDOM.parentNode).toBeNull();
    expect(oldDOM.innerText).toBe("old text");
    expect(oldUpdates).toBe(0);
    expect(lifecycle).toContain("old:beforeUnmount");
    expect(lifecycle).toContain("old:unmounted");
    expect(lifecycle).toContain("new:beforeMount");
    expect(lifecycle).toContain("new:mounted");
    expect(lifecycle.indexOf("old:beforeUnmount")).toBeLessThan(
      lifecycle.indexOf("old:unmounted")
    );
    expect(lifecycle.indexOf("new:beforeMount")).toBeLessThan(
      lifecycle.indexOf("new:mounted")
    );
  });
});
