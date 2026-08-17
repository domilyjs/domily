type Listener = (event: Event) => unknown;

export class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;

  append(...nodes: Node[]): void {
    for (const node of nodes) {
      const fake = node as unknown as FakeNode;
      fake.parentNode = this;
      this.childNodes.push(fake);
    }
  }

  contains(node: Node | null): boolean {
    const candidate = node as unknown as FakeNode | null;
    return candidate === this || this.childNodes.some((child) => child.contains(candidate as unknown as Node));
  }

  replaceChildren(...nodes: Node[]): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

export class FakeText extends FakeNode {
  constructor(private value: string) {
    super();
  }

  override get textContent(): string {
    return this.value;
  }

  set textContent(value: string) {
    this.value = value;
  }
}

export class FakeStyle {
  cssText = '';
  private readonly values = new Map<string, string>();

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? '';
  }

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }
}

export class FakeEvent {
  defaultPrevented = false;
  currentTarget: EventTarget | null = null;

  constructor(
    readonly type: string,
    values: Record<string, unknown> = {},
  ) {
    Object.assign(this, values);
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

export class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>();
  checked = false;
  className = '';
  disabled = false;
  href = '';
  rel = '';
  selectionDirection: SelectionDirection | null = 'none';
  selectionEnd: number | null = 0;
  selectionStart: number | null = 0;
  readonly style = new FakeStyle();
  target = '';
  type = '';
  value = '';
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {
    super();
  }

  addEventListener(name: string, listener: Listener): void {
    const listeners = this.listeners.get(name) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  async emit(name: string, values: Record<string, unknown> = {}): Promise<FakeEvent> {
    const event = new FakeEvent(name, values);
    event.currentTarget = this as unknown as EventTarget;
    for (const listener of this.listeners.get(name) ?? []) {
      await listener(event as unknown as Event);
    }
    return event;
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  removeEventListener(name: string, listener: Listener): void {
    this.listeners.get(name)?.delete(listener);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'target') this.target = value;
    if (name === 'rel') this.rel = value;
    if (name === 'href') this.href = value;
  }

  setSelectionRange(start: number | null, end: number | null, direction?: SelectionDirection): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction ?? 'none';
  }

  findByTag(tagName: string): FakeElement | undefined {
    if (this.tagName === tagName) return this;
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        const found = child.findByTag(tagName);
        if (found) return found;
      }
    }
    return undefined;
  }
}

export class FakeDocument {
  activeElement: FakeElement | null = null;
  private readonly selectors = new Map<string, FakeElement>();

  createElement(tagName: string): HTMLElement {
    return new FakeElement(this, tagName) as unknown as HTMLElement;
  }

  createTextNode(value: string): Text {
    return new FakeText(value) as unknown as Text;
  }

  querySelector(selector: string): Element | null {
    return (this.selectors.get(selector) ?? null) as unknown as Element | null;
  }

  register(selector: string, element: FakeElement): void {
    this.selectors.set(selector, element);
  }
}

export function createFakeRoot(document = new FakeDocument()): { document: FakeDocument; root: FakeElement } {
  return { document, root: new FakeElement(document, 'root') };
}
