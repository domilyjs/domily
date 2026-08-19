export function useOverrideParams<
  T extends Record<string, any> = Record<string, any>,
  P extends keyof T = string,
  A extends Function = Function
>(target: T, property: P, action: A) {
  const original = Reflect.get(target, property);
  Reflect.defineProperty(target, property, {
    writable: true,
    configurable: true,
    value: function (...args: any[]) {
      if (typeof original !== "function") {
        return original;
      }
      return typeof action === "function"
        ? original.apply(this, action.apply(this, args))
        : original.apply(this, args);
    },
  });
}

export function useOverrideBefore<
  T extends Record<string, any> = Record<string, any>,
  P extends keyof T = string,
  A extends Function = Function
>(target: T, property: P, action: A) {
  const original = Reflect.get(target, property);
  Reflect.defineProperty(target, property, {
    writable: true,
    configurable: true,
    value: function (...args: any[]) {
      if (typeof original !== "function") {
        return original;
      }
      if (typeof action === "function") {
        action.apply(this, args);
      }
      return original.apply(this, args);
    },
  });
}

export function useOverrideAfter<
  T extends Record<string, any> = Record<string, any>,
  P extends keyof T = string,
  A extends Function = Function
>(target: T, property: P, action: A) {
  const original = Reflect.get(target, property);
  Reflect.defineProperty(target, property, {
    writable: true,
    configurable: true,
    value: function (...args: any[]) {
      if (typeof original !== "function") {
        return original;
      }
      const rs = original.apply(this, args);
      if (typeof action === "function") {
        action.apply(this, [...args, rs]);
      }
      return rs;
    },
  });
}

export function useOverrideReturnValue<
  T extends Record<string, any> = Record<string, any>,
  P extends keyof T = string,
  A extends Function = Function
>(target: T, property: P, action: A) {
  const original = Reflect.get(target, property);
  Reflect.defineProperty(target, property, {
    writable: true,
    configurable: true,
    value: function (...args: any[]) {
      if (typeof original !== "function") {
        return original;
      }
      return typeof action === "function"
        ? action.apply(this, [...args, original.apply(this, args)])
        : original.apply(this, args);
    },
  });
}
