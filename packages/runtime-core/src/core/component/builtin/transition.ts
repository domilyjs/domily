import { KebabToCamel } from "../../../utils/dom";
import { isFunction } from "../../../utils/is";
import { ref, computed, handleWithFunType } from "../../reactive";
import { type IDomilyRenderOptions } from "../../render";

const classNames = (value: (string | undefined)[]) => {
  return value.filter(Boolean).join(" ");
};

const nextFrame = (callback: FrameRequestCallback) => {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
};

function toMilliseconds(time: string) {
  if (time.endsWith("ms")) {
    return parseFloat(time);
  } else if (time.endsWith("s")) {
    return parseFloat(time) * 1000;
  }
  return 0;
}

function getTotalTransitionTime(element: HTMLElement) {
  if (!(element instanceof HTMLElement)) {
    return 0;
  }
  const style = window.getComputedStyle(element);
  const durations = style.transitionDuration.split(",").map((d) => d.trim());
  const delays = style.transitionDelay.split(",").map((d) => d.trim());

  const durationArray = durations.map(toMilliseconds);
  const delayArray = delays.map(toMilliseconds);
  const maxLength = Math.max(durationArray.length, delayArray.length);
  const totalTimes = Array.from({ length: maxLength }, (_, index) => {
    const duration = durationArray[index % durationArray.length] ?? 0;
    const delay = delayArray[index % delayArray.length] ?? 0;
    return duration + delay;
  });
  const maxTotalTime = Math.max(...totalTimes);
  return maxTotalTime;
}

interface IAnimationClassNames {
  enterFrom: string;
  enterActive: string;
  enterTo: string;
  leaveFrom: string;
  leaveActive: string;
  leaveTo: string;
}

interface IBaseTransitionProps {
  name?: string;
  duration?: number | { enter?: number; leave?: number };
  type?: "transition" | "animation";
  slot?: IDomilyRenderOptions;
  enterFromClass?: string;
  enterActiveClass?: string;
  enterToClass?: string;
  appearFromClass?: string;
  appearActiveClass?: string;
  appearToClass?: string;
  leaveFromClass?: string;
  leaveActiveClass?: string;
  leaveToClass?: string;
}

interface ITransitionEvents {
  onBeforeEnter?: (el: HTMLElement | Node | null) => void;
  onEnter?: (el: HTMLElement | Node | null, done: () => void) => void;
  onAfterEnter?: (el: HTMLElement | Node | null) => void;
  onBeforeLeave?: (el: HTMLElement | Node | null) => void;
  onLeave?: (el: HTMLElement | Node | null, done: () => void) => void;
  onAfterLeave?: (el: HTMLElement | Node | null) => void;
  onBeforeAppear?: (el: HTMLElement | Node | null) => void;
  onAppear?: (el: HTMLElement | Node | null, done: () => void) => void;
  onAfterAppear?: (el: HTMLElement | Node | null) => void;
}

export default function Transition(
  props?: IBaseTransitionProps & ITransitionEvents
) {
  const {
    name,
    slot,
    type = "transition",
    duration,
    enterFromClass = "",
    enterActiveClass = "",
    enterToClass = "",
    appearFromClass = "",
    appearActiveClass = "",
    appearToClass = "",
    leaveFromClass = "",
    leaveActiveClass = "",
    leaveToClass = "",
  } = props || {};

  function callEvent(
    e: keyof ITransitionEvents,
    dom: HTMLElement | Node | null,
    done: () => void = () => {}
  ) {
    const event = props?.[e];
    if (isFunction(event)) {
      event(dom, done);
    }
  }

  if (!name || !slot) {
    return slot;
  }

  const animationClassNames = Object.fromEntries(
    [
      "enter-from",
      "enter-active",
      "enter-to",
      "leave-from",
      "leave-active",
      "leave-to",
    ].map((e) => [KebabToCamel(e), `${name}-${e}`])
  ) as unknown as IAnimationClassNames;

  const cls = ref<string>("");

  const enter = (dom: HTMLElement | Node | null) => {
    let timer: number;
    if (dom instanceof HTMLElement) {
      cls.value = classNames([
        animationClassNames.enterFrom,
        animationClassNames.enterActive,
        enterFromClass,
        appearFromClass,
      ]);
      callEvent("onBeforeAppear", dom);
    }
    nextFrame(() => {
      if (!dom) {
        return;
      }
      const end = () => {
        clearTimeout(timer);
        if (enterToClass || appearToClass) {
          cls.value = classNames([enterToClass, appearToClass]);
          return;
        }
        if (cls.value !== "") {
          cls.value = "";
        }
      };

      dom?.addEventListener(type + "end", end, { once: true });

      const totalTransitionTime = getTotalTransitionTime(dom as HTMLElement);

      const timeout =
        typeof duration === "number"
          ? duration
          : typeof duration === "object" && typeof duration?.enter === "number"
          ? duration.enter
          : totalTransitionTime + 1;

      timer = window.setTimeout(end, timeout);

      cls.value = classNames([
        animationClassNames.enterActive,
        animationClassNames.enterTo,
        enterActiveClass,
      ]);
      const done = () => {
        callEvent("onAfterEnter", dom);
        if (dom instanceof HTMLElement) {
          callEvent("onAfterAppear", dom);
        }
      };
      callEvent("onEnter", dom, done);
      if (dom instanceof HTMLElement) {
        callEvent("onAppear", dom, done);
        cls.value = classNames([
          animationClassNames.enterActive,
          animationClassNames.enterTo,
          enterActiveClass,
          appearActiveClass,
        ]);
      }
    });
  };
  const leave = (dom: HTMLElement | Node | null) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    cls.value = classNames([
      animationClassNames.leaveFrom,
      animationClassNames.leaveActive,
      leaveFromClass,
    ]);
    callEvent("onBeforeLeave", dom);

    let timer: number;

    nextFrame(() => {
      if (!dom) {
        return;
      }
      const end = () => {
        clearTimeout(timer);
        if (leaveToClass) {
          cls.value = leaveToClass;
          resolve();
          return;
        }
        if (cls.value !== "") {
          cls.value = "";
        }
        resolve();
      };

      dom?.addEventListener(type + "end", end, { once: true });

      const totalTransitionTime = getTotalTransitionTime(dom as HTMLElement);

      const timeout =
        typeof duration === "number"
          ? duration
          : typeof duration === "object" && typeof duration?.leave === "number"
          ? duration.leave
          : totalTransitionTime + 1;

      timer = window.setTimeout(end, timeout);

      cls.value = classNames([
        animationClassNames.leaveActive,
        animationClassNames.leaveTo,
        leaveActiveClass,
      ]);
      const done = () => {
        callEvent("onAfterLeave", dom);
        resolve();
      };
      callEvent("onLeave", dom, done);
    });
    return promise;
  };

  const originalBeforeMount = slot.beforeMount;
  const originalMounted = slot.mounted;
  const originalBeforeUnmount = slot.beforeUnmount;
  const originalUnmounted = slot.unmounted;
  const originalClassName = slot.className;

  slot.beforeMount = (dom: HTMLElement | Node | null) => {
    if (typeof originalBeforeMount === "function") {
      originalBeforeMount(dom);
    }
    cls.value = classNames([
      animationClassNames.enterFrom,
      animationClassNames.enterActive,
      enterFromClass,
    ]);
    callEvent("onBeforeEnter", dom);
  };

  slot.mounted = (dom: HTMLElement | Node | null) => {
    if (typeof originalMounted === "function") {
      originalMounted(dom);
    }
    enter(dom);
  };

  slot.beforeUnmount = (dom: HTMLElement | Node | null) => {
    if (typeof originalBeforeUnmount === "function") {
      originalBeforeUnmount(dom);
    }
    return leave(dom);
  };

  slot.unmounted = () => {
    if (typeof originalUnmounted === "function") {
      originalUnmounted();
    }
  };

  slot.className = computed(() =>
    classNames([handleWithFunType(originalClassName), cls.value])
  );

  return slot;
}
