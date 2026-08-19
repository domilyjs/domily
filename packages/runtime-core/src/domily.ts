import {
  registerElement,
  render,
  type DOMilyMountableRender,
  type DOMilyTags,
  type IDomilyRenderOptions,
  type CustomParamsToMap,
  type OptionalWith,
} from "./core/render";
import { createApp } from "./core/app";
import { HTMLNodeNameMap, SVGElementNameMap } from "./utils/tags";

function builtinDomily() {
  const Domily = {
    createApp,
    render,
    registerElement<T extends string>(
      tag: T,
      constructor?: CustomElementConstructor | undefined
    ) {
      return registerElement(Domily, tag, constructor);
    },
  };
  /**
   * register HTMLElementTagNameMap
   */
  Object.keys(HTMLNodeNameMap).forEach((tag) => {
    Domily.registerElement(tag);
  });
  /**
   * register SVGElementTagNameMap
   */
  Domily.registerElement(`svg`);
  Object.keys(SVGElementNameMap).forEach((tag) => {
    Domily.registerElement(`SVG:${tag}`);
  });
  /**
   * register RouterView
   */
  Domily.registerElement(`router-view`);
  /**
   * register fragment
   */
  Domily.registerElement(`fragment`);
  /**
   * register rich-text
   */
  Domily.registerElement(`rich-text`);
  return Domily as unknown as DOMily;
}

function registerCustomElements<T extends DOMily, P extends string[] | object>(
  Domily: T,
  needRegisterCustomElements?: P
) {
  if (!needRegisterCustomElements) {
    return Domily as OptionalWith<T, P, DOMily<CustomParamsToMap<P>>>;
  }
  if (
    Array.isArray(needRegisterCustomElements) &&
    needRegisterCustomElements.length
  ) {
    needRegisterCustomElements.forEach((tag) => {
      Domily.registerElement(tag);
    });
  } else if (
    typeof needRegisterCustomElements === "object" &&
    needRegisterCustomElements !== null
  ) {
    Object.keys(needRegisterCustomElements).forEach((tag) => {
      const value =
        needRegisterCustomElements[
          tag as keyof typeof needRegisterCustomElements
        ];
      if (!value) {
        Domily.registerElement(tag);
      } else if (typeof value === "function") {
        Domily.registerElement(tag, value as CustomElementConstructor);
      }
    });
  }
  return Domily as OptionalWith<T, P, DOMily<CustomParamsToMap<P>>>;
}

export function createDomily<T extends string[] | object = {}>(
  customElement?: T
) {
  return registerCustomElements(builtinDomily(), customElement);
}

export const Domily = createDomily();

export type DOMily<CustomTagNameMap = {}> = {
  [T in DOMilyTags<CustomTagNameMap>]: (
    schema?: Omit<IDomilyRenderOptions<CustomTagNameMap, T>, "tag">
  ) => DOMilyMountableRender<CustomTagNameMap, T>;
} & DOMilyBase<CustomTagNameMap>;

export type DOMilyBase<CustomTagNameMap = {}> = {
  createApp: typeof createApp;
  render: typeof render;
  registerElement<T extends string>(
    tag: T,
    constructor?: CustomElementConstructor | undefined
  ): DOMily<
    typeof constructor extends new (...args: any) => infer R
      ? CustomTagNameMap & { [key in T]: R }
      : CustomTagNameMap
  >;
};
