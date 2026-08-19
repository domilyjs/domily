import { describe, expect, test } from "bun:test";
import { effect, signal } from "alien-signals";

import reactive, {
  isReactive,
  isShallowReactive,
  shallowReactive,
} from "../src/core/reactive/reactive";
import { toRef, toRaw } from "../src/core/reactive/utils";
import { watchEffect } from "../src/core/reactive/handle-effect";
import ref, { isRef } from "../src/core/reactive/ref";

describe("reactive", () => {
  test("exposes stable reactive metadata and the latest raw value", () => {
    const state = reactive({ count: 0 });
    const shallow = shallowReactive({ count: 0 });

    expect(isReactive(state)).toBe(true);
    expect(isShallowReactive(shallow)).toBe(true);
    expect(toRaw(state)).toEqual({ count: 0 });

    state.count = 2;
    expect(toRaw(state)).toEqual({ count: 2 });
  });

  test("preserves arrays for indexed writes, mutators, and replacement", () => {
    const items = reactive([1, 2]);

    items[0] = 3;
    expect(Array.isArray(items())).toBe(true);
    expect(items()).toEqual([3, 2]);

    items.push(4);
    expect(Array.isArray(items())).toBe(true);
    expect(items()).toEqual([3, 2, 4]);

    items([5, 6]);
    expect(items()).toEqual([5, 6]);
  });

  test("keeps Map and Set methods usable and reactive", () => {
    const map = reactive(new Map([["count", 1]]));
    const set = reactive(new Set(["a"]));
    let observedMap = 0;
    let observedSet = false;

    effect(() => {
      observedMap = map.get("count") || 0;
      observedSet = set.has("b");
    });

    map.set("count", 2);
    set.add("b");

    expect(map.get("count")).toBe(2);
    expect(set.has("b")).toBe(true);
    expect(observedMap).toBe(2);
    expect(observedSet).toBe(true);
  });

  test("keeps object methods and nested refs reactive without changing function identity", () => {
    const nested = ref(1);
    const state = reactive({
      count: 0,
      nested,
      increment() {
        this.count += 1;
      },
    });
    let observed = -1;
    effect(() => {
      observed = state.count;
    });

    state.increment();

    expect(state.count).toBe(1);
    expect(observed).toBe(1);
    expect(state.nested).toBe(nested);
    expect(isRef(state.nested)).toBe(true);
  });

  test("keeps built-in instances usable without proxying their internal slots", () => {
    const date = new Date(0);
    const url = new URL("https://domily.test/path");
    const nested = reactive({ date, url });

    expect(nested.date.getTime()).toBe(0);
    expect(nested.url.toString()).toBe("https://domily.test/path");
    expect(reactive(new Date(0)).getTime()).toBe(0);
    expect(ref(date).value.getTime()).toBe(0);
  });

  test("proxies nested Map values so deep writes notify effects", () => {
    const map = reactive(new Map([["item", { count: 1 }]]));
    let observed = 0;
    effect(() => {
      observed = map.get("item")?.count ?? 0;
    });

    const item = map.get("item");
    item!.count = 2;

    expect(map.get("item")).toEqual({ count: 2 });
    expect(observed).toBe(2);
  });

  test("merges delayed deep writes into the latest reactive object and Map", () => {
    const state = reactive({ count: 0, user: { name: "A" } });
    const user = state.user;

    state.count = 1;
    user.name = "B";

    expect(state()).toEqual({ count: 1, user: { name: "B" } });

    const map = reactive(new Map([["item", { name: "A" }]]));
    const item = map.get("item");

    map.set("other", { name: "C" });
    item!.name = "B";

    expect(map()).toEqual(
      new Map([
        ["item", { name: "B" }],
        ["other", { name: "C" }],
      ])
    );
  });

  test("does not proxy nested values from shallow Map reactivity", () => {
    const item = { count: 1 };
    const map = shallowReactive(new Map([["item", item]]));

    expect(map.get("item")).toBe(item);
  });

  test("notifies effects for nested property deletion", () => {
    const state = reactive({ nested: { value: 1 } as { value?: number } });
    let observed: number | undefined;

    effect(() => {
      observed = state.nested.value;
    });
    delete state.nested.value;

    expect(observed).toBeUndefined();
  });
});

describe("toRef", () => {
  test("stays linked to its source property in both directions", () => {
    const state = reactive({ count: 0 });
    const count = toRef(state, "count");

    count.value = 1;
    expect(state.count).toBe(1);

    state.count = 2;
    expect(count.value).toBe(2);
    expect(count()).toBe(2);
  });

  test("returns the latest raw value for refs", () => {
    const count = ref(1);
    count.value = 2;

    expect(toRaw(count)).toBe(2);
  });
});

describe("ref", () => {
  test("tracks deep writes through nested Map values", () => {
    const state = ref({ items: new Map([["item", { count: 1 }]]) });
    let observed = 0;

    effect(() => {
      observed = state.value.items.get("item")?.count ?? 0;
    });

    state.value.items.get("item")!.count = 2;

    expect(observed).toBe(2);
    expect(state.value.items.get("item")).toEqual({ count: 2 });
  });

  test("keeps nested functions reactive and preserves nested ref identity", () => {
    const nested = ref(1);
    const state = ref({
      count: 0,
      nested,
      increment() {
        this.count += 1;
      },
    });
    let observed = -1;

    effect(() => {
      observed = state.value.count;
    });

    state.value.increment();

    expect(observed).toBe(1);
    expect(state.value.nested).toBe(nested);
  });
});

describe("watchEffect", () => {
  test("collects the initial value once without notifying the callback", () => {
    const count = signal(1);
    let reads = 0;
    const changes: Array<[number, number]> = [];

    const result = watchEffect(
      () => {
        reads += 1;
        return count();
      },
      (next, previous) => changes.push([next, previous])
    );

    expect(reads).toBe(1);
    expect(result.value).toBe(1);
    expect(changes).toEqual([]);

    count(2);
    expect(reads).toBe(2);
    expect(changes).toEqual([[2, 1]]);
  });
});
