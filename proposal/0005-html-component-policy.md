# 0005：通用 HTML 组件映射的白名单与安全边界

- 状态：已确认
- 日期：2026-08-12
- 关联：[0001-schema-driven-ui.md](./0001-schema-driven-ui.md)、[0003-authoring-dsl.md](./0003-authoring-dsl.md)

## 1. 决策

MVP 采用“默认拒绝、显式注册”的通用 HTML 映射，而不是把浏览器所有标签、属性和 DOM API 透传给可下发文档。每个允许的标签都由注册表声明 props、事件、事件 payload 和值校验器。

文档不能插入原始 HTML、内联 JavaScript、任意 URL 或任意 CSS；复杂/高风险能力必须以专用组件加 capability 形式加入。

## 2. 为什么需要白名单

可下发文档属于不可信输入。`on*` 事件属性、`javascript:` URL、HTML 字符串、`iframe`、随意的 CSS 和外部资源都会跨越“配置”到“可执行内容”的边界。OWASP 建议只将不可信值放入硬编码的安全属性列表，并将 URL 与其他危险上下文单独校验；严格 CSP 是必要的纵深防御，但不能替代输入验证和安全渲染。[OWASP XSS 防护指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) [MDN CSP 指南](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)

## 3. MVP 允许的标签

| 类别 | 允许标签 |
| --- | --- |
| 文档与布局 | `div`、`span`、`p`、`main`、`section`、`article`、`header`、`footer`、`nav`、`h1`–`h6` |
| 表单 | `form`、`label`、`input`、`textarea`、`select`、`option`、`button` |
| 列表与表格 | `ul`、`ol`、`li`、`table`、`thead`、`tbody`、`tr`、`th`、`td` |
| 内容与导航 | `a`、`img`、`strong`、`em`、`small`、`code` |
| 协议结构节点 | `fragment`、`text`、`when`、`repeat` |

`input` 仅允许常规文本、数字、日期、复选与单选类型；具体类型采用 allowlist，不使用“除 file 之外都允许”的反向规则。

## 4. MVP 直接拒绝

### 标签

`script`、`style`、`link`、`meta`、`base`、`iframe`、`object`、`embed`、`portal`、`template`、`slot`、`svg`、`math`、`audio`、`video`、`canvas`、`webview`、自定义元素，以及所有未注册标签。

### 属性与 DOM 接口

- 所有 `on*` 属性，例如 `onclick`、`onerror`、`onload`；事件只能写在协议 `events` 字段中；
- `innerHTML`、`outerHTML`、`srcdoc`、`nonce`、`is`、`popoverTargetAction`；
- `contenteditable`、`draggable`、`autofocus`、`inert`、`accesskey`；
- `form.action`、`form.method`、`formAction`、`formMethod`、`formTarget`；
- 任意未注册的 property、attribute、dataset key 或 ARIA key；
- 直接 DOM 引用、选择器、`Document`、`Window`、`EventTarget` 和浏览器 API。

### 样式

- 禁止 `style` 字符串、`style` 对象、`css` 字段、`className` 的任意字符串与 CSS 变量写入；
- MVP 仅允许注册表声明的 `class`、`variant`、`size`、`tone` 等枚举型展示 props；
- 动态展示状态通过组件属性（如 `hidden`、`disabled`、`aria-*`）表达，不以动态 CSS 表达；
- 以后若开放受限样式，只允许逐条 CSS property 白名单和值校验，绝不允许 selector、`url()`、`@import` 或自由文本 CSS。

## 5. 属性策略

### 5.1 全局安全属性

允许各已注册标签按其契约使用：`id`、`title`、`hidden`、`role`、`aria-*`、注册的 `data-*`、以及由设计系统注册的 `class`/`variant`/`size`/`tone`。

`id`、`data-*` 需要名称与长度限制；`aria-*` 必须是已知 ARIA 属性并按其预期标量类型校验。`role` 必须来自允许 role 集合。注册表不得通过“任意 string”的 props 类型绕过这些校验。

### 5.2 表单属性

`input`、`textarea`、`select`、`option`、`button` 和 `label` 按标签精确声明，例如：

```ts
defineHtmlComponent("input", {
  props: {
    type: enumOf("text", "email", "number", "password", "date", "checkbox", "radio"),
    name: string({ maxLength: 128 }),
    value: bindableString({ maxLength: 4096 }),
    checked: bindableBoolean(),
    disabled: bindableBoolean(),
    required: boolean(),
    placeholder: string({ maxLength: 256 }),
  },
  events: {
    input: event.value(),
    change: event.valueOrChecked(),
    blur: event.none(),
  },
});
```

`form` 不执行原生 action/method 提交。它只允许声明 `submit` 事件，运行时调用 `preventDefault()` 后执行协议 action。

## 6. 事件策略

文档事件采用 `events: { click: ActionRef }`，而不是 HTML 的 `onclick` 属性。每个组件可暴露的事件必须被注册表枚举。

MVP 事件白名单：

- 通用：`click`、`focus`、`blur`；
- 表单：`input`、`change`、`submit`；
- 键盘：`keydown`、`keyup`，payload 仅包含 `key`、`code`、受限修饰键和 `repeat`。

运行时将浏览器事件投影为最小、可序列化的 payload，例如：

```ts
type InputEventPayload = { value: string; checked?: boolean };
type KeyboardEventPayload = {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
};
```

不开放原始 event、event target、剪贴板、拖放、文件或任何可变 DOM 引用。

## 7. URL 与外部资源

| 使用位置 | MVP 策略 |
| --- | --- |
| `a.href` | 仅允许相对 URL 与 `https:`；可由宿主按需加入 `mailto:`、`tel:`。拒绝 `javascript:`、`data:`、`blob:` 和未知协议。 |
| `a.target` | 仅允许 `_self`、`_blank`；`_blank` 自动补 `rel="noopener noreferrer"`。 |
| `img.src` | 仅允许相对 URL 或宿主资源 allowlist 中的 `https:` URL；限制长度与可选域名集合。 |
| 网络请求 | 文档没有 URL 级请求能力；全部使用已授权 capability。 |

URL 先按标准 URL 解析，再检查协议、源和长度；不能仅用字符串前缀判断。

## 8. 以后以专用能力开放

以下能力不在 MVP 的通用 HTML 映射中出现：

- 富文本：`RichText` 组件 + 严格 sanitizer + 专门的 HTML schema；
- 文件上传：`FileUpload` 组件 + `files.upload` capability；
- 拖放：`SortableList` / `DropZone` 组件 + 最小化拖放 payload；
- 嵌入内容：`EmbeddedFrame` 组件 + 来源 allowlist、sandbox 和专门权限；
- SVG、图表、地图、媒体、canvas：独立组件契约，而非开放原生标签；
- 动态样式：设计令牌和受限 Style API，后续单独 RFC。

## 9. 运行时防线与测试

1. AST validator：标签、props、事件、URL、action 与 capability 的结构/类型白名单；
2. renderer adapter：即使上游漏检也只调用安全 DOM sink，例如文本使用 `textContent`，属性名必须是硬编码/注册过的属性；
3. App Shell：严格 CSP，禁用 inline script、`eval`、`javascript:` URL；
4. delivery loader：只 mount 已通过 envelope、codec、AST 和权限校验的文档；
5. 测试：每个拒绝项有 fixture；URL 协议绕过、`on*`、HTML 注入、属性绕过、事件 payload 脱敏和 `_blank` 的 `rel` 都有回归测试。

CSP 是纵深防御，不是让不安全 AST 合法化的理由。
