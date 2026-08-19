import { signal } from "alien-signals";
import { INTERNAL_RAW_KEY, isProxyable, proxyObject, toRaw } from "./utils";
import type { Reactive } from "./type";

const INTERNAL_REACTIVE_KEY = Symbol("reactive");
const INTERNAL_REACTIVE_FLAG = "reactive";
const INTERNAL_SHALLOW_REACTIVE_FLAG = "shallowReactive";

const COLLECTION_MUTATORS = {
  Array: new Set([
    "copyWithin",
    "fill",
    "pop",
    "push",
    "reverse",
    "shift",
    "sort",
    "splice",
    "unshift",
  ]),
  Map: new Set(["set", "delete", "clear"]),
  Set: new Set(["add", "delete", "clear"]),
};

export function isReactive<T extends object = any>(
  value: any
): value is Reactive<T> {
  const flag = value?.[INTERNAL_REACTIVE_KEY];
  return typeof value === "function" && Object.is(INTERNAL_REACTIVE_FLAG, flag);
}

export function isShallowReactive<T extends object = any>(
  value: any
): value is Reactive<T> {
  const flag = value?.[INTERNAL_REACTIVE_KEY];
  return (
    typeof value === "function" &&
    Object.is(INTERNAL_SHALLOW_REACTIVE_FLAG, flag)
  );
}

function cloneContainer<T extends object>(value: T): T {
  if (Array.isArray(value)) {
    return value.slice() as T;
  }
  if (value instanceof Map) {
    return new Map(value) as T;
  }
  if (value instanceof Set) {
    return new Set(value) as T;
  }

  return Object.defineProperties(
    Object.create(Object.getPrototypeOf(value)),
    Object.getOwnPropertyDescriptors(value)
  ) as T;
}

function collectionType(value: object) {
  if (Array.isArray(value)) {
    return "Array" as const;
  }
  if (value instanceof Map) {
    return "Map" as const;
  }
  if (value instanceof Set) {
    return "Set" as const;
  }
  return null;
}

function proxyCollectionValue<T>(
  value: T,
  update: (value: T) => void
): T {
  return typeof value === "object" && value !== null
    ? (proxyObject(value, update) as T)
    : value;
}

function shouldReplace<T extends object>(current: T, next: Partial<T>) {
  return (
    Array.isArray(current) ||
    current instanceof Map ||
    current instanceof Set ||
    Array.isArray(next) ||
    next instanceof Map ||
    next instanceof Set
  );
}

function createReactive<T extends object>(
  initialValue: T,
  flag: typeof INTERNAL_REACTIVE_FLAG | typeof INTERNAL_SHALLOW_REACTIVE_FLAG,
  shallow: boolean
) {
  const initialRawValue = toRaw(initialValue) as T;
  const value = signal<T>(initialRawValue);

  const replace = (nextValue: T) => {
    value(nextValue);
  };
  const setter = (nextValue: Partial<T>) => {
    const current = value();
    replace(
      (shouldReplace(current, nextValue)
        ? nextValue
        : Object.assign(cloneContainer(current), nextValue)) as T
    );
  };

  Reflect.defineProperty(value, INTERNAL_REACTIVE_KEY, {
    configurable: false,
    writable: false,
    value: flag,
  });
  Reflect.defineProperty(value, INTERNAL_RAW_KEY, {
    configurable: false,
    get() {
      return value();
    },
  });

  return new Proxy(value as Reactive<T>, {
    get(target, property, receiver) {
      if (property === INTERNAL_REACTIVE_KEY || property === INTERNAL_RAW_KEY) {
        return Reflect.get(target, property, target);
      }

      const current = target();
      const result = Reflect.get(current, property, current);
      const type = collectionType(current);

      if (typeof result === "function") {
        if (type && COLLECTION_MUTATORS[type].has(String(property))) {
          return (...args: unknown[]) => {
            const next = cloneContainer(target());
            const method = Reflect.get(next, property, next) as Function;
            const output = Reflect.apply(method, next, args);
            replace(next);
            return output === next ? receiver : output;
          };
        }
        if (type === "Map" && property === "get") {
          return (key: unknown) => {
            const child = (current as Map<unknown, unknown>).get(key);
            return shallow
              ? child
              : proxyCollectionValue(child, (nextChild) => {
                  const next = new Map(
                    target() as Map<unknown, unknown>
                  );
                  next.set(key, nextChild);
                  replace(next as T);
                });
          };
        }
        return type || !isProxyable(current) ? result.bind(current) : result;
      }

      if (!shallow && isProxyable(result)) {
        return proxyObject(result, (nextChild) => {
          const next = cloneContainer(target());
          Reflect.set(next, property, nextChild);
          replace(next);
        });
      }
      return result;
    },
    set(target, property, nextPropertyValue) {
      const next = cloneContainer(target());
      const success = Reflect.set(next, property, nextPropertyValue);
      if (success) {
        replace(next);
      }
      return success;
    },
    deleteProperty(target, property) {
      const next = cloneContainer(target());
      const success = Reflect.deleteProperty(next, property);
      if (success) {
        replace(next);
      }
      return success;
    },
    defineProperty(target, property, attributes) {
      const next = cloneContainer(target());
      const success = Reflect.defineProperty(next, property, attributes);
      if (success) {
        replace(next);
      }
      return success;
    },
    apply(target, thisArg, argumentsList) {
      if (argumentsList.length === 0) {
        return Reflect.apply(target, thisArg, argumentsList);
      }
      setter(argumentsList[0] as Partial<T>);
    },
  });
}

export default function reactive<T extends object>(initialValue: T) {
  if (isReactive<T>(initialValue)) {
    return initialValue;
  }
  return createReactive(initialValue, INTERNAL_REACTIVE_FLAG, false);
}

export function shallowReactive<T extends object>(initialValue: T) {
  if (isShallowReactive<T>(initialValue)) {
    return initialValue;
  }
  return createReactive(initialValue, INTERNAL_SHALLOW_REACTIVE_FLAG, true);
}
