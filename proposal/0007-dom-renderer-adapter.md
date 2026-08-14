# 0007：DOM Renderer Adapter、受控组件注册表与事件投影

- 状态：MVP 已实现
- 日期：2026-08-14
- 关联：[0005-html-component-policy.md](./0005-html-component-policy.md)、[0006-action-runtime.md](./0006-action-runtime.md)

## 1. 决策

`@domily/next-renderer-dom` 是浏览器端的 adapter，而不是新的响应式框架或第二个 runtime。它只把已经通过 loader、validator 并交给 `DocumentRuntime` 的 `ViewNode` 渲染为 DOM：

```text
validated Document + DocumentRuntime + trusted DOM component registry
  -> ViewNode evaluate
  -> safe DOM nodes / constrained attributes
  -> sanitized event payload
  -> runtime.dispatch()
```

renderer 不解析文档、不校验 envelope、不执行 capability，也不接收原始 JavaScript 回调。所有状态变化仍由 0006 runtime 提交；renderer 订阅提交后的 state 并重新投影 view。

## 2. 组件注册表

DOM renderer 接受的是宿主代码构造的 `DomComponentRegistry`，不能由 Document 自己声明标签、属性写入器或事件投影器：

```ts
interface DomComponentDefinition {
  tagName: string;
  // 与 validator 共享的声明面
  props: ReadonlySet<string>;
  events: ReadonlySet<string>;
  // 仅宿主可信 registry 可提供的 DOM 行为
  propWriters: ReadonlyMap<string, DomPropWriter>;
  eventProjectors: ReadonlyMap<string, DomEventProjector>;
}

interface DomComponentRegistry {
  get(name: string): DomComponentDefinition | undefined;
}
```

Document 中的 `component`、`props`、`events` 都必须命中同一个注册表。一个注册表定义是受信任宿主代码；Document 只是选择预先注册的能力，不能传入 property 名、CSS、HTML 字符串、DOM sink 或 event projector。

MVP 提供 `createMvpDomRegistry()`，实现 0005 的 HTML allowlist。它使用：

- `createElement()`、`createTextNode()` 与 `textContent`；不使用 `innerHTML`、HTML parser 或 `setAttribute` 的动态属性名；
- 每个 prop 的固定 writer，例如 string attribute、boolean attribute、受限 enum、长度受限数值、受限 URL；
- `<a target="_blank">` 自动设置 `rel="noopener noreferrer"`；
- `img.src` 的绝对 `https:` 来源必须被宿主在注册表 options 中显式 allowlist，relative URL 可直接使用；
- 文档未注册的 tag、prop 或 event 即使绕过 validator 也会在 renderer 再次拒绝。

自定义业务组件以后以另一个 adapter 实现；MVP 不把 Web Component、React component 或任意函数塞进 registry。

## 3. ViewNode 投影

| AST 节点 | DOM 行为 |
| --- | --- |
| `text` | 仅接受标量；`null` 渲染为空文本，其他对象/数组报错。 |
| `element` | 创建注册 tag，求值已注册 props，绑定已注册事件，再渲染 children。 |
| `fragment` | 展开为相邻 child nodes。 |
| `when` | 条件必须是 boolean；false 时不产生节点。 |
| `repeat` | `in` 必须求值为数组；每轮 scope 提供 `each` 与 `$index`。 |

`repeat.key` 是渲染身份，不是可见 HTML attribute。提供时必须求值为唯一的 string、number 或 boolean；重复/复合 key 抛错。未提供时使用 index，并由开发环境/AI 生成诊断提示其在可重排列表中的风险。

MVP 采用完整 view 重新投影，而不在本阶段实现虚拟 DOM。renderer 为每个节点保留内部、不可配置的 node id，并在同一根节点内尽力恢复 input/textarea 的焦点与 selection；这保证常见受控表单在 input action 后不会丢失输入位置。`key` 为后续增量 reconciler 预留稳定身份，但不承诺 DOM node 复用或 hydration。

## 4. 事件投影与动作触发

文档事件只包含 `ActionNode`/`ActionNode[]`。renderer 的事件 listener 固定执行以下流程：

1. 对 `submit` 调用 `preventDefault()`；
2. 使用注册 event projector 从浏览器事件复制最小 JSON payload；
3. 使用当前 repeat scope 调用 `runtime.dispatch(actions, { event, scope })`；
4. dispatch 成功后由 runtime 订阅触发重新投影；失败只交给宿主的 `onError`，不留下未处理 Promise。

MVP payload 是 `click/focus/blur -> {}`、`input/change -> { value }` 或 `{ checked }`、`keydown/keyup -> { key, code, altKey, ctrlKey, metaKey, shiftKey, repeat }`。原始 `Event`、target、文件、clipboard、拖放和 DOM 引用不跨越这个边界。

## 5. 生命周期与挂载

```ts
const renderer = new DomRenderer(runtime, registry, { onError });
await renderer.mount(root);     // 初次 render 后执行可选 lifecycle.mounted
await renderer.unmount();       // 可选 lifecycle.unmounted 后清理 DOM/subscription
```

只有 `mounted` 和 `unmounted` 是 DOM adapter 触发的标准 lifecycle 名称。文档没有权限观察浏览器 document、window、visibility、route 或卸载原事件；这类需求以后以宿主 capability 或专用 adapter 决定。

`mount()` 的初次投影或 lifecycle 失败会通知 `onError`、释放 DOM/subscription 并使 Promise reject；`unmount()` 无论 lifecycle 成功或失败均清理 DOM 和 subscription，失败随后 rethrow。renderer 不自行吞掉可观测的生命周期失败。

## 6. 安全与错误边界

renderer 是 validator 的第二道防线，而不是替代 validator。它必须在运行时拒绝：未知 component/prop/event、危险 URL、非标量 text、错误的 `when`/`repeat` 类型、不安全 repeat variable、重复 key 以及 writer 不接受的值。

来自 registry 的 writer/projector 属于宿主可信代码；其余所有数据都视为不可信 AST 或 capability/state 结果。写入失败不会回滚已经提交的 runtime state，因此 `onError` 应使宿主记录诊断并按产品策略显示 fallback 或卸载文档。

## 7. MVP 验收

1. `text`、`element`、`fragment`、`when`、`repeat` 正确投影，并能使用 runtime 的 state、derived 与 loop scope；
2. 0005 MVP 标签/props/events 在 renderer 中再次按注册表限制；
3. `input`、`change`、键盘和 `submit` 只产生最小 JSON payload，事件可驱动 runtime action；
4. 未知 prop、`innerHTML`、不安全 URL、对象 text、重复 key 被拒绝且不写入危险 DOM sink；
5. capability/action 错误经 `onError` 报告，不产生未处理 Promise；
6. mounted/unmounted 生命周期、subscription cleanup 与受控 input 焦点恢复有回归测试。

## 8. 非目标

- SSR、hydration、流式渲染；
- 虚拟 DOM diff、动画、transition、portal；
- 任意 CSS、内联 style、SVG/HTML 字符串；
- 文件、拖放、clipboard、复杂浏览器事件；
- React/Vue/Svelte component 直接互操作。
