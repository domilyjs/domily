import { effect, effectScope } from "alien-signals";
import { isFunction } from "../../utils/is";
import { deepClone } from "../../utils/obj";
import type { WithFuncType } from "./type";

export function handleWithFunType<T>(option: WithFuncType<T>) {
  const value = isFunction(option) ? option() : option;
  return typeof value === "object" && value !== null ? deepClone(value) : value;
}

export function stoppableEffect(fn: () => void) {
  return effectScope(() => {
    effect(fn);
  });
}

export function handleFunTypeEffect<T>(
  option: WithFuncType<T>,
  handleEffect?: (newValue: T) => void,
  gatherEffectAborts?: (() => void)[],
  handled = false
) {
  if (handled) {
    return;
  }
  if (isFunction(handleEffect)) {
    const stopScope = stoppableEffect(() => {
      handleEffect(handleWithFunType(option));
    });
    if (Array.isArray(gatherEffectAborts)) {
      gatherEffectAborts.push(stopScope);
    }
  }
}

export function watchEffect<T>(
  option: WithFuncType<T>,
  handleEffect: (next: T, previous: T) => void,
  gatherEffectAborts?: (() => void)[],
  handled = false,
  isEqual: (next: T, previous: T) => boolean = (a, b) => Object.is(a, b),
  update: (next: T, previous: T) => T = (next, _previous) => next
) {
  const result = { value: void 0 as T };
  let initialized = false;
  handleFunTypeEffect(
    option,
    (newValue) => {
      if (!initialized) {
        result.value = newValue;
        initialized = true;
        return;
      }
      if (isEqual(newValue, result.value)) {
        return;
      }
      handleEffect(newValue, result.value);
      result.value = update(newValue, result.value);
    },
    gatherEffectAborts,
    handled
  );
  return result;
}
