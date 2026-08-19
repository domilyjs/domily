import type { WithFuncType } from "../reactive/type";
import type {
  DOMilyCustomElementComponent,
  DOMilyMountableRender,
  IDomilyRenderOptions,
} from "../render";
import DomilyRenderSchema from "../render/schema";
import { domilyChildToDOMilyMountableRender } from "../render/shared/parse";

export * from "./builtin";

export interface DOMilyComponent {
  (props?: any):
    | WithFuncType<DomilyRenderSchema>
    | WithFuncType<IDomilyRenderOptions<any, any>>
    | WithFuncType<DOMilyMountableRender<any, any>>
    | WithFuncType<DOMilyCustomElementComponent>;
}

export type AsyncDOMilyComponentModule = Promise<{ default: DOMilyComponent }>;

export function parseComponent(
  props: Record<string, any>,
  functionComponent: DOMilyComponent,
  _nocache?: boolean
) {
  const comp = functionComponent(props);
  const mountable = domilyChildToDOMilyMountableRender(comp);
  if (!mountable) {
    return null;
  }
  return mountable;
}
