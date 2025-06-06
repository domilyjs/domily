import { teleportDOM } from "../../../utils/dom";
import { domilyChildToDOM } from "../shared/parse";
import type { DOMilyChildren } from "../type/types";

export default class DomilyFragment extends HTMLElement {
  static name = "domily-fragment";
  initialChildren: DOMilyChildren;
  constructor(children: DOMilyChildren = []) {
    super();
    this.initialChildren = children;
  }
  connectedCallback() {
    if (!this.initialChildren?.length) {
      return;
    }
    const documentFragment = document.createDocumentFragment();
    for (const item of this.initialChildren) {
      const dom = domilyChildToDOM(item);
      if (dom) {
        const teleported = teleportDOM(dom);
        if (teleported) {
          continue;
        }
        documentFragment.append(dom);
      }
    }
    this.appendChild(documentFragment);
  }
}
