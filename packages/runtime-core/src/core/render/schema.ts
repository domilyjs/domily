import type {
  DOMilyCascadingStyleSheets,
  DOMilyChild,
  DOMilyChildDOM,
  DOMilyChildren,
  DOMilyEventKeys,
  DOMilyEventListenerRecord,
  DOMilyRenderOptionsPropsOrAttrs,
  DOMilyTags,
  IDomilyCustomElementOptions,
  IDomilyRenderOptions,
  ILifecycleItem,
  LifecycleName,
  TDomilyRenderProperties,
} from "./type/types";
import {
  c,
  ensurePromiseOrder,
  f,
  h,
  handleCSS,
  handleHiddenStyle,
  internalCreateElement,
  mountable,
  removeDOM,
  replaceDOM,
  rt,
  rv,
  setDOMClassNames,
  txt,
} from "../../utils/dom";
import { hasDiff, merge } from "../../utils/obj";
import { isFunction, isIterable } from "../../utils/is";
import { domilyChildToDOM } from "./shared/parse";
import DomilyFragment from "./custom-elements/fragment";
import DomilyRouterView from "./custom-elements/router-view";
import { EventBus, EVENTS } from "../../utils/event-bus";
import {
  handleFunTypeEffect,
  handleWithFunType,
  watchEffect,
} from "../reactive/handle-effect";
import { LIST_MAP_KEY_ATTR } from "../../config";
import type { WithFuncType } from "../reactive/type";

export default class DomilyRenderSchema<
  CustomElementMap = {},
  K extends DOMilyTags<CustomElementMap> = DOMilyTags,
  ListData = any
> implements IDomilyRenderOptions<CustomElementMap, K, ListData>
{
  /**
   * base info
   */
  tag: K;
  id?: WithFuncType<string>;
  className?: WithFuncType<string>;

  /**
   * the selector of the container to teleport
   */
  to?: string | HTMLElement | ShadowRoot;

  /**
   * style info
   */
  css?: WithFuncType<string | DOMilyCascadingStyleSheets>;
  style?: WithFuncType<string | Partial<CSSStyleDeclaration>>;

  /**
   * properties and attributes
   */
  props?: WithFuncType<DOMilyRenderOptionsPropsOrAttrs<CustomElementMap, K>>;
  attrs?: WithFuncType<DOMilyRenderOptionsPropsOrAttrs<CustomElementMap, K>>;

  /**
   * content and children
   */
  text?: WithFuncType<string | number>;
  html?: WithFuncType<string>;
  children?: DOMilyChildren;

  /**
   * eventListeners
   */
  on?: DOMilyEventListenerRecord<DOMilyEventKeys>;

  /**
   * display controller
   */
  domIf?: WithFuncType<boolean>;
  domShow?: WithFuncType<boolean>;

  /**
   * list-loop
   */
  mapList?: {
    list: WithFuncType<Iterable<ListData>>;
    map: (data: ListData, index: number) => DOMilyChild | DOMilyChildDOM;
  };
  key?: WithFuncType<string | number>;
  private mappedSchemaList: (DOMilyChild | DOMilyChildDOM)[] = [];
  private mappedDOMList: Node[] = [];

  /**
   * custom element
   */
  customElement?: IDomilyCustomElementOptions = {
    enable: void 0,
    name: void 0,
    useShadowDOM: false,
    shadowDOMMode: "open",
  };

  /**
   * for reactive update
   */
  __dom: HTMLElement | Node | null = null;

  /**
   * life cycle
   */
  beforeMount?: (dom: HTMLElement | Node | null) => void | Promise<unknown>;
  mounted?: (dom: HTMLElement | Node | null) => void;
  updated?: (dom: HTMLElement | Node | null) => void;
  beforeUnmount?: (dom: HTMLElement | Node | null) => void | Promise<unknown>;
  unmounted?: () => void;
  private childLifeCycleQueue: ILifecycleItem[] = [];

  /**
   * internal status
   */
  private _initialed = false;
  private _internalEffectAborts: (() => void)[] = [];
  private _internalDomIfRenderQueue: (() => Promise<void>)[] = [];
  private _internalDomIfRenderQueueExecuting = false;

  eventsAbortController: Map<DOMilyEventKeys, AbortController> = new Map();

  static create<
    CustomElementMap = {},
    K extends DOMilyTags<CustomElementMap> = DOMilyTags,
    ListData = any
  >(schema: IDomilyRenderOptions<CustomElementMap, K, ListData>) {
    return new DomilyRenderSchema<CustomElementMap, K, ListData>(schema);
  }

  constructor(schema: IDomilyRenderOptions<CustomElementMap, K>) {
    /**
     * base info
     */
    this.tag = schema.tag;
    this.id = schema.id;
    this.className = schema.className;

    /**
     * the selector of the container to teleport
     */
    this.to = schema.to;

    /**
     * style info
     */
    this.css = schema.css;
    this.style = schema.style;

    /**
     * properties and attributes
     */
    this.props = schema.props;
    this.attrs = schema.attrs;

    /**
     * content and children
     */
    this.text = schema.text;
    this.html = schema.html;
    this.children = schema.children;

    /**
     * eventListeners
     */
    this.on = this.handleEvents(schema.on);

    /**
     * display controller
     */
    this.domIf = this.handleDIf(schema.domIf);
    this.domShow = this.handleDShow(schema.domShow);

    /**
     * list-loop
     */
    this.mapList = schema.mapList;
    this.key = schema.key;

    /**
     * custom element
     */
    this.customElement = merge(this.customElement, schema.customElement);

    /**
     * life cycle
     */
    this.handleLifeCycle(schema);
  }

  async executeQueueRender() {
    if (this._internalDomIfRenderQueueExecuting) {
      return;
    }
    this._internalDomIfRenderQueueExecuting = true;
    while (this._internalDomIfRenderQueue.length) {
      const promise = this._internalDomIfRenderQueue.shift();
      if (typeof promise === "function") {
        await promise();
      }
    }
    this._internalDomIfRenderQueueExecuting = false;
  }

  handleLifeCycle(schema: IDomilyRenderOptions<CustomElementMap, K>) {
    this.beforeMount = (dom) => {
      const rs: (void | Promise<unknown>)[] = [];
      if (schema.beforeMount && isFunction(schema.beforeMount)) {
        rs.push(schema.beforeMount(dom));
      }
      this.childLifeCycleQueue.forEach((child) => {
        if (child.beforeMount && isFunction(child.beforeMount)) {
          rs.push(child.beforeMount(child.dom));
        }
      });
      return Promise.allSettled(rs);
    };

    this.mounted = (dom) => {
      if (schema.mounted && isFunction(schema.mounted)) {
        schema.mounted(dom);
      }
      this.childLifeCycleQueue.forEach((child) => {
        if (child.mounted && isFunction(child.mounted)) {
          child.mounted(child.dom);
        }
      });
    };

    this.updated = (dom) => {
      if (schema.updated && isFunction(schema.updated)) {
        schema.updated(dom);
      }
      this.childLifeCycleQueue.forEach((child) => {
        if (child.updated && isFunction(child.updated)) {
          child.updated(child.dom);
        }
      });
    };

    this.beforeUnmount = (dom) => {
      const rs: (void | Promise<unknown>)[] = [];
      if (schema.beforeUnmount && isFunction(schema.beforeUnmount)) {
        rs.push(schema.beforeUnmount(dom));
      }
      this.childLifeCycleQueue.forEach((child) => {
        if (child.beforeUnmount && isFunction(child.beforeUnmount)) {
          rs.push(child.beforeUnmount(child.dom));
        }
      });
      return Promise.allSettled(rs);
    };

    this.unmounted = () => {
      this.childLifeCycleQueue.forEach((child) => {
        if (child.unmounted && isFunction(child.unmounted)) {
          child.unmounted();
        }
      });
      if (schema.unmounted && isFunction(schema.unmounted)) {
        schema.unmounted();
      }
    };
  }

  runLifecycle(lifecycle: LifecycleName) {
    /**
     * ignore updated when initial
     */
    if (lifecycle === "updated" && !this._initialed) {
      return;
    }
    if (isFunction(this[lifecycle])) {
      this[lifecycle](this.__dom);
    }
  }

  handleEventsOption(
    originalOptions: AddEventListenerOptions | undefined,
    abortController: AbortController
  ) {
    if (originalOptions?.signal) {
      originalOptions.signal.addEventListener("abort", () => {
        abortController.abort();
      });
    }
    return {
      ...originalOptions,
      signal: abortController.signal,
    } as AddEventListenerOptions;
  }

  handleEvents(events?: DOMilyEventListenerRecord<DOMilyEventKeys>) {
    if (!events) {
      return void 0;
    }
    return Object.fromEntries(
      Object.keys(events)
        .map((key) => {
          const value = events[key as DOMilyEventKeys];
          const abortController = new AbortController();
          this.eventsAbortController.set(
            key as DOMilyEventKeys,
            abortController
          );
          if (typeof value === "function") {
            return [
              key,
              {
                event: value,
                option: {
                  signal: abortController.signal,
                },
              },
            ];
          }
          if (typeof value === "object" && value !== null) {
            if ("option" in value) {
              const option =
                typeof value.option === "boolean"
                  ? {
                      capture: value.option,
                      signal: abortController.signal,
                    }
                  : this.handleEventsOption(value.option, abortController);
              return [
                key,
                {
                  event: value.event,
                  option,
                },
              ];
            }
            return [
              key,
              {
                event: value,
                option: {
                  signal: abortController.signal,
                },
              },
            ];
          }
          return [];
        })
        .filter((e) => e.length)
    ) as DOMilyEventListenerRecord<DOMilyEventKeys>;
  }

  handleDIf(dIf?: boolean | (() => boolean)) {
    return () => {
      if (typeof dIf === "undefined") {
        return true;
      }
      if (typeof dIf === "function") {
        return dIf();
      }
      return dIf;
    };
  }

  handleDShow(show?: boolean | (() => boolean)) {
    return () => {
      if (typeof show === "undefined") {
        return true;
      }
      if (typeof show === "function") {
        return show();
      }
      return show;
    };
  }

  handleCustomElement(dom: HTMLElement | Node) {
    const {
      enable,
      name,
      useShadowDOM,
      shadowDOMMode,
      css: customElementCSS,
    } = this.customElement || {};
    if (!enable || !name) {
      return dom;
    }

    let previousCSS: HTMLStyleElement | null = null;

    if (customElementCSS) {
      previousCSS = handleCSS(handleWithFunType(customElementCSS));
      handleFunTypeEffect(
        customElementCSS,
        (css) => {
          const nextStyle = handleCSS(css);
          if (
            previousCSS &&
            nextStyle &&
            previousCSS.innerText === nextStyle.innerText
          ) {
            return;
          }
          previousCSS = replaceDOM(
            previousCSS,
            nextStyle
          ) as HTMLStyleElement | null;
          this.runLifecycle("updated");
        },
        this._internalEffectAborts
      );
    }
    const CustomElementComponent = class extends HTMLElement {
      shadowRoot: ShadowRoot | null = null;
      child: HTMLElement | Node | null = null;
      styleTag?: HTMLStyleElement | null = null;
      constructor(
        child: HTMLElement | Node | null,
        styleTag?: HTMLStyleElement | null
      ) {
        super();
        this.child = child;
        this.styleTag = styleTag;
        if (useShadowDOM) {
          this.shadowRoot = this.attachShadow({
            mode: shadowDOMMode || "open",
          });
        }
      }
      connectedCallback() {
        const container = this.shadowRoot ?? this;
        if (this.styleTag) {
          container.appendChild(this.styleTag);
        }
        if (this.child) {
          container.appendChild(this.child);
        }
      }
    };
    const CEC = customElements.get(name);
    if (!CEC) {
      customElements.define(name, CustomElementComponent);
      return new CustomElementComponent(dom, previousCSS);
    }
    return new CEC(dom, previousCSS);
  }

  domWithKey(dom: HTMLElement | Node) {
    let previousKey = handleWithFunType(this.key);
    if (!previousKey) {
      return dom;
    }

    Reflect.set(dom, LIST_MAP_KEY_ATTR, previousKey);
    handleFunTypeEffect(
      this.key,
      (nextKey) => {
        if (Object.is(previousKey, nextKey)) {
          return;
        }
        if (!this.__dom || !handleWithFunType(this.domIf)) {
          return;
        }
        const previousDOM = this.__dom;
        const nextDOM = this.render();
        this.__dom = replaceDOM(previousDOM, nextDOM);
        if (this.__dom) {
          Reflect.set(this.__dom, LIST_MAP_KEY_ATTR, nextKey);
        }
        this.runLifecycle("updated");
        previousKey = nextKey;
      },
      this._internalEffectAborts
    );

    return dom;
  }

  domInterrupter(dom: HTMLElement | Node | null) {
    if (!dom) {
      this._initialed = true;
      return dom;
    }
    const nextDOM = this.domWithKey(this.handleCustomElement(dom));
    this._initialed = true;
    return nextDOM;
  }

  updateDOMList(
    map?: (data: ListData, index: number) => DOMilyChild | DOMilyChildDOM,
    list?: Iterable<ListData> | null
  ) {
    if (!this.__dom || !handleWithFunType(this.domIf)) {
      return;
    }
    this.mappedDOMList.forEach((keyNode) => {
      removeDOM(keyNode);
    });
    this.mappedSchemaList = [];
    this.mappedDOMList = [];
    const nextMappedListFragment = document.createDocumentFragment();
    if (isIterable(list) && isFunction(map)) {
      let i = 0;
      for (const item of list) {
        const child = map.apply(list, [item, i++]);
        this.mappedSchemaList.push(child);
        const childDOM = domilyChildToDOM(
          child,
          this.childLifeCycleQueue,
          this._internalEffectAborts
        );
        if (childDOM) {
          this.mappedDOMList.push(childDOM);
          nextMappedListFragment.appendChild(childDOM);
        }
      }
    }
    this.__dom?.appendChild(nextMappedListFragment);
    this.runLifecycle("updated");
  }

  gatherInternalEffectAborts(gatherArray: (() => void)[]) {
    for (const abort of this._internalEffectAborts) {
      if (isFunction(abort)) {
        gatherArray.push(abort);
      }
    }
  }

  abortEffect() {
    for (const abort of this._internalEffectAborts) {
      if (isFunction(abort)) {
        abort();
      }
    }
    this._internalEffectAborts = [];
  }

  initialRenderStatus() {
    this.childLifeCycleQueue = [];
    this.mappedSchemaList = [];
    this.mappedDOMList = [];
    this.abortEffect();
  }

  render(): HTMLElement | Node | null {
    /**
     * ensure rendering status is initialization
     */
    this.initialRenderStatus();
    /**
     * handle list-map
     */
    if (this.mapList) {
      let previousList = handleWithFunType(this.mapList.list);
      handleFunTypeEffect(
        this.mapList.list,
        (nextList) => {
          if (
            !hasDiff(previousList, nextList, (k, lv, rv) => {
              if (k === "key") {
                return !Object.is(lv, rv);
              }
              return true;
            })
          ) {
            return;
          }
          this.updateDOMList(this.mapList?.map, nextList);
          previousList = nextList;
        },
        this._internalEffectAborts
      );
      if (isIterable(previousList) && isFunction(this.mapList?.map)) {
        let i = 0;
        for (const item of previousList) {
          const child = this.mapList.map.apply(previousList, [item, i++]);
          if (!this.mappedSchemaList) {
            this.mappedSchemaList = [child];
          } else {
            this.mappedSchemaList.push(child);
          }
        }
      }
    }

    /**
     * handle dom-if
     */
    let previousDomIf = handleWithFunType(this.domIf);
    handleFunTypeEffect(
      this.domIf,
      (nextDomIf) => {
        const handler = async () => {
          const hideDOM = () => {
            this.__dom = this.domInterrupter(
              replaceDOM(this.__dom, c("dom-if"))
            );
          };
          const rebuildDOM = () => {
            const originalDom = this.__dom;
            const nextDom = this.render();
            this.__dom = replaceDOM(originalDom, nextDom);
          };
          if (previousDomIf === nextDomIf) {
            return;
          }
          if (!this.__dom?.isConnected) {
            return;
          }
          if (!nextDomIf) {
            await ensurePromiseOrder(
              this.beforeUnmount,
              () => {
                hideDOM();
                if (typeof this.unmounted === "function") {
                  this.unmounted();
                }
              },
              [this.__dom]
            );
          } else {
            await ensurePromiseOrder(
              this.beforeMount,
              () => {
                rebuildDOM();
                if (typeof this.mounted === "function") {
                  this.mounted(this.__dom);
                }
              },
              [this.__dom]
            );
          }
          previousDomIf = nextDomIf;
        };
        this._internalDomIfRenderQueue.push(handler);
        this.executeQueueRender();
      },
      this._internalEffectAborts
    );
    if (!previousDomIf) {
      this.__dom = this.domInterrupter(c("dom-if"));
      return this.__dom;
    }

    /**
     * handle dom-show
     */
    const previousDomShow = watchEffect(
      this.domShow,
      (nextDomShow) => {
        if (this.__dom && "style" in this.__dom) {
          this.__dom.style.cssText = handleHiddenStyle(
            this.__dom.style.cssText,
            !nextDomShow
          ) as string;
          this.runLifecycle("updated");
        }
      },
      this._internalEffectAborts
    );

    /**
     * Text Node
     */
    if (this.tag === "text") {
      const previousText = watchEffect(
        this.text,
        (text) => {
          this.__dom = this.domInterrupter(
            replaceDOM(this.__dom, txt(!previousDomShow.value ? void 0 : text))
          );
          this.runLifecycle("updated");
        },
        this._internalEffectAborts
      );
      this.__dom = this.domInterrupter(
        txt(!previousDomShow.value ? void 0 : previousText.value)
      );
      return this.__dom;
    }

    /**
     * Comment Node
     */
    if (this.tag === "comment") {
      const previousText = watchEffect(
        this.text,
        (text) => {
          this.__dom = this.domInterrupter(
            replaceDOM(
              this.__dom,
              c(!previousDomShow.value ? '"domily-comment-hidden"' : text)
            )
          );
          this.runLifecycle("updated");
        },
        this._internalEffectAborts
      );
      this.__dom = this.domInterrupter(
        c(previousText.value ?? "domily-comment")
      );
      return this.__dom;
    }

    let previousCSS = handleCSS(handleWithFunType(this.css));
    handleFunTypeEffect(
      this.css,
      (css) => {
        const nextStyle = handleCSS(css);
        if (
          previousCSS &&
          nextStyle &&
          previousCSS.innerText === nextStyle.innerText
        ) {
          return;
        }
        previousCSS = replaceDOM(
          previousCSS,
          nextStyle
        ) as HTMLStyleElement | null;
        this.runLifecycle("updated");
      },
      this._internalEffectAborts
    );

    let previousStyle = handleHiddenStyle(
      handleWithFunType(this.style),
      !previousDomShow.value
    );
    handleFunTypeEffect(
      this.style,
      (style) => {
        const nextStyle = handleHiddenStyle(style, !previousDomShow.value);
        if (previousStyle === nextStyle) {
          return;
        }
        if (this.__dom && "style" in this.__dom) {
          this.__dom.style.cssText =
            typeof nextStyle === "string" ? nextStyle : "";
          this.runLifecycle("updated");
        }
        previousStyle = nextStyle;
      },
      this._internalEffectAborts
    );

    let children = (this.children
      ?.map((child) =>
        domilyChildToDOM(
          child,
          this.childLifeCycleQueue,
          this._internalEffectAborts
        )
      )
      .filter((e) => !!e) || []) as (HTMLElement | Node)[];

    this.mappedDOMList = (this.mappedSchemaList
      ?.map((child) =>
        domilyChildToDOM(
          child,
          this.childLifeCycleQueue,
          this._internalEffectAborts
        )
      )
      .filter((e) => !!e) || []) as (HTMLElement | Node)[];

    if (this.mappedDOMList.length) {
      children = children.concat(this.mappedDOMList);
    }

    if (previousCSS) {
      children.unshift(previousCSS);
    }

    const props = {
      ...(() => {
        let previousProps = handleWithFunType(this.props);
        handleFunTypeEffect(
          this.props,
          (nextProps) => {
            if (!hasDiff(previousProps, nextProps)) {
              return;
            }
            if (!this.__dom || !nextProps) {
              return;
            }
            Object.keys(nextProps).forEach((k) => {
              Reflect.set(this.__dom as HTMLElement, k, nextProps[k]);
            });
            this.runLifecycle("updated");
            previousProps = nextProps;
          },
          this._internalEffectAborts
        );
        return previousProps;
      })(),
      ...(this.id
        ? {
            id: (() => {
              let previousId = handleWithFunType(this.id);
              handleFunTypeEffect(
                this.id,
                (id) => {
                  if (id === previousId) {
                    return;
                  }
                  if (this.__dom) {
                    Reflect.set(this.__dom as HTMLElement, "id", id);
                    this.runLifecycle("updated");
                  }
                  previousId = id;
                },
                this._internalEffectAborts
              );
              return previousId;
            })(),
          }
        : {}),
      ...(this.className
        ? {
            className: (() => {
              let previousClassName = handleWithFunType(this.className);
              handleFunTypeEffect(
                this.className,
                (className) => {
                  if (className === previousClassName) {
                    return;
                  }
                  if (this.__dom) {
                    setDOMClassNames(
                      this.__dom as HTMLElement,
                      this.tag as string,
                      className
                    );
                    this.runLifecycle("updated");
                  }
                  previousClassName = className;
                },
                this._internalEffectAborts
              );
              return previousClassName;
            })(),
          }
        : {}),
      ...(this.html
        ? {
            innerHTML: (() => {
              let previousHTML = handleWithFunType(this.html);
              handleFunTypeEffect(
                this.html,
                (html) => {
                  if (html === previousHTML) {
                    return;
                  }
                  if (this.__dom) {
                    Reflect.set(this.__dom as HTMLElement, "innerHTML", html);
                    this.runLifecycle("updated");
                  }
                  previousHTML = html;
                },
                this._internalEffectAborts
              );
              return previousHTML;
            })(),
          }
        : this.text
        ? {
            innerText: (() => {
              let previousText = handleWithFunType(this.text);
              handleFunTypeEffect(
                this.text,
                (text) => {
                  if (text === previousText) {
                    return;
                  }
                  if (this.__dom) {
                    Reflect.set(this.__dom as HTMLElement, "innerText", text);
                    this.runLifecycle("updated");
                  }
                  previousText = text;
                },
                this._internalEffectAborts
              );
              return previousText;
            })(),
          }
        : {}),
      attrs: (() => {
        let previousAttrs = handleWithFunType(this.attrs);
        handleFunTypeEffect(
          this.attrs,
          (nextAttrs) => {
            if (!hasDiff(previousAttrs, nextAttrs)) {
              return;
            }
            if (!this.__dom || !nextAttrs) {
              return;
            }
            Object.keys(nextAttrs).forEach((k) => {
              (this.__dom as HTMLElement).setAttribute(k, nextAttrs[k]);
            });
            this.runLifecycle("updated");
            previousAttrs = nextAttrs;
          },
          this._internalEffectAborts
        );
        return previousAttrs;
      })(),
      style: previousStyle,
      on: this.on,
    } as unknown as TDomilyRenderProperties<CustomElementMap, K>;

    if ([DomilyFragment.name, "fragment"].includes(this.tag as string)) {
      this.__dom = this.domInterrupter(
        internalCreateElement(
          () => f(children),
          props,
          void 0,
          this._internalEffectAborts,
          () => this.runLifecycle("updated")
        )
      );
    } else if (this.tag === DomilyRouterView.name) {
      this.__dom = this.domInterrupter(
        internalCreateElement(
          () => rv(children),
          props,
          void 0,
          this._internalEffectAborts,
          () => this.runLifecycle("updated")
        )
      );
    } else if (this.tag === "rich-text") {
      const html = props.innerHTML;
      delete props.innerHTML;
      this.__dom = this.domInterrupter(
        internalCreateElement(
          () => rt({ html }),
          props,
          void 0,
          this._internalEffectAborts,
          () => this.runLifecycle("updated")
        )
      );
    } else {
      this.__dom = this.domInterrupter(
        h<CustomElementMap, K>(
          this.tag,
          props,
          children,
          this._internalEffectAborts,
          () => this.runLifecycle("updated")
        ) as HTMLElement
      );
    }
    return this.__dom;
  }
}

export function render<K extends DOMilyTags, ListData = any>(
  schema: IDomilyRenderOptions<{}, K, ListData>
) {
  return mountable(DomilyRenderSchema.create(schema));
}

export function registerElement<ThisArgs extends object, T extends string>(
  thisArgs: ThisArgs,
  tag: T,
  constructor?: CustomElementConstructor | undefined
) {
  if (constructor && !customElements.get(tag)) {
    customElements.define(tag, constructor);
  }
  Reflect.set(thisArgs, tag, (schema?: Record<string, any>) => {
    return render({ ...schema, tag } as any);
  });
  return thisArgs;
}

if (!EventBus.has(EVENTS.__INTERNAL_UPDATE)) {
  EventBus.on(
    EVENTS.__INTERNAL_UPDATE,
    ({
      nextSchema,
      originalSchema,
    }: {
      nextSchema: DomilyRenderSchema<any, any, any> | null;
      originalSchema: DomilyRenderSchema<any, any, any> | null;
    }) => {
      if (!originalSchema) {
        return;
      }
      originalSchema.__dom = replaceDOM(
        originalSchema.__dom,
        nextSchema?.render?.() || null
      );
    }
  );
}
