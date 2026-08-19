import { deepClone } from "../../utils/obj";
import { createPropertyRef } from "./ref";
import type { LiftFuncType, Reactive, Ref } from "./type";

export const INTERNAL_RAW_KEY = Symbol("raw");

const COLLECTION = {
  Map: Map,
  Set: Set,
  Array: Array,
};

const COLLECTION_METHODS = {
  Map: ["set", "delete", "clear"],
  Set: ["add", "delete", "clear"],
  Array: ["push", "pop", "shift", "unshift", "splice", "sort", "reverse"],
} as const;

export function isProxyable(value: unknown): value is object {
  if (value === null || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value) || value instanceof Map || value instanceof Set) {
    return true;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function handleCollectionMethod(
  target: any,
  prop: string | symbol,
  value: Function,
  update: (value: any) => void,
  collection: keyof typeof COLLECTION,
  contractor: (typeof COLLECTION)[keyof typeof COLLECTION]
) {
  if (
    target instanceof contractor &&
    // @ts-ignore
    COLLECTION_METHODS[collection].includes(prop)
  ) {
    return function (...args: any[]) {
      const result = Reflect.apply(value, target, args);
      update(deepClone(target));
      return result;
    };
  }
}

export function proxyObject<T extends object>(
  original: T,
  update: (value: T) => void
): T {
  if (!isProxyable(original)) {
    return original;
  }

  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      if (target instanceof Map && prop === "get") {
        return (key: unknown) => {
          const entry = target.get(key);
          return typeof entry === "object" && entry !== null
            ? proxyObject(entry, (nextEntry) => {
                const next = new Map(target);
                next.set(key, nextEntry);
                update(next as unknown as T);
              })
            : entry;
        };
      }

      let _receiver = receiver;

      if (
        Object.keys(COLLECTION).some(
          (key) => target instanceof COLLECTION[key as keyof typeof COLLECTION]
        )
      ) {
        _receiver = original;
      }

      const value = Reflect.get(target, prop, _receiver);

      if (typeof value === "function") {
        const collectionMethod = Object.keys(COLLECTION)
          .map((key) =>
            handleCollectionMethod(
              target,
              prop,
              value,
              update,
              key as keyof typeof COLLECTION,
              COLLECTION[key as keyof typeof COLLECTION]
            )
          )
          .filter((entry) => !!entry)
          .at(0);

        if (collectionMethod) {
          return collectionMethod;
        }

        return target instanceof Map || target instanceof Set || Array.isArray(target)
          ? value.bind(target)
          : value;
      }
      if (typeof value === "object" && value !== null) {
        return proxyObject(value, (newVal) => {
          const clone = deepClone(target);
          clone[prop as keyof T] = newVal;
          update(clone);
        });
      }
      return value;
    },
    set(target, prop, newValue) {
      const result = Reflect.set(target, prop, newValue);
      if (result) {
        update(deepClone(target));
      }
      return result;
    },
    deleteProperty(target, prop) {
      const result = Reflect.deleteProperty(target, prop);
      if (result) {
        update(deepClone(target));
      }
      return result;
    },
    defineProperty(target, prop, attributes) {
      const result = Reflect.defineProperty(target, prop, attributes);
      if (result) {
        update(deepClone(target));
      }
      return result;
    },
  };

  return new Proxy(original, handler);
}

export function toRef<T extends object, K extends keyof T>(obj: T, key: K) {
  return createPropertyRef(
    () => obj[key] as LiftFuncType<T[K]>,
    (value) => {
      obj[key] = value as T[K];
    }
  );
}

export function toRefs<T extends object>(obj: T) {
  const result = {} as {
    [K in keyof T]: Ref<LiftFuncType<T[K]>>;
  };
  const keys = Reflect.ownKeys(obj);
  for (const key of keys) {
    result[key as keyof T] = toRef(obj, key as keyof T);
  }
  return result;
}

export function toRaw<T>(
  value: T
): T extends Ref<infer R> ? R : T extends Reactive<infer R> ? R : T {
  if (typeof value !== "function") {
    // @ts-ignore
    return value;
  }

  if (Reflect.has(value, INTERNAL_RAW_KEY)) {
    // @ts-ignore
    return Reflect.get(value, INTERNAL_RAW_KEY);
  }

  // @ts-ignore
  return value;
}
