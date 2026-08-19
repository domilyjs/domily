import { signal } from "alien-signals";
import { proxyObject, toRaw, INTERNAL_RAW_KEY } from "./utils";
import type { Ref } from "./type";

const INTERNAL_REF_KEY = Symbol("ref");
const INTERNAL_REF_FLAG = "ref";
const INTERNAL_SHALLOW_REF_FLAG = "shallowRef";

export function isRef<T = any>(value: any): value is Ref<T> {
  const flag = value?.[INTERNAL_REF_KEY];
  return (
    typeof value === "function" &&
    "value" in value &&
    Object.is(INTERNAL_REF_FLAG, flag)
  );
}

export function isShallowRef<T = any>(value: any): value is Ref<T> {
  const flag = value?.[INTERNAL_REF_KEY];
  return (
    typeof value === "function" &&
    "value" in value &&
    Object.is(INTERNAL_SHALLOW_REF_FLAG, flag)
  );
}

export function createPropertyRef<T>(
  get: () => T,
  set: (value: T) => void
): Ref<T> {
  const propertyRef = ((...args: [T?]) => {
    if (args.length === 0) {
      return get();
    }
    set(args[0] as T);
  }) as Ref<T>;

  Reflect.defineProperty(propertyRef, "value", {
    get,
    set,
  });
  Reflect.defineProperty(propertyRef, INTERNAL_REF_KEY, {
    configurable: false,
    writable: false,
    value: INTERNAL_REF_FLAG,
  });
  Reflect.defineProperty(propertyRef, INTERNAL_RAW_KEY, {
    configurable: false,
    get,
  });

  return propertyRef;
}

export default function ref<T>(value: T): Ref<T> {
  if (isRef<T>(value)) {
    return value;
  }
  value = toRaw(value) as T;

  const signalValue = signal(value);
  Reflect.defineProperty(signalValue, "value", {
    get() {
      const rs = signalValue();
      return typeof rs === "object" && rs !== null
        ? proxyObject(rs, signalValue)
        : rs;
    },
    set(newValue: T) {
      signalValue(newValue);
      Reflect.set(signalValue, INTERNAL_RAW_KEY, signalValue());
    },
  });

  Reflect.defineProperty(signalValue, INTERNAL_REF_KEY, {
    configurable: false,
    writable: false,
    value: INTERNAL_REF_FLAG,
  });

  Reflect.defineProperty(signalValue, INTERNAL_RAW_KEY, {
    configurable: false,
    get() {
      return signalValue();
    },
  });

  return signalValue as Ref<T>;
}

export function shallowRef<T>(value: T): Ref<T> {
  if (isShallowRef<T>(value)) {
    return value;
  }
  value = toRaw(value) as T;

  const signalValue = signal(value);
  Reflect.defineProperty(signalValue, "value", {
    get() {
      const rs = signalValue();
      return rs;
    },
    set(newValue: T) {
      signalValue(newValue);
      Reflect.set(signalValue, INTERNAL_RAW_KEY, signalValue());
    },
  });

  Reflect.defineProperty(signalValue, INTERNAL_REF_KEY, {
    configurable: false,
    writable: false,
    value: INTERNAL_SHALLOW_REF_FLAG,
  });

  Reflect.defineProperty(signalValue, INTERNAL_RAW_KEY, {
    configurable: false,
    get() {
      return signalValue();
    },
  });
  return signalValue as Ref<T>;
}
