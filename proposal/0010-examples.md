# 0010：业务示例工程基线

- 状态：MVP 已实现
- 日期：2026-08-14
- 关联：[0003-authoring-dsl.md](./0003-authoring-dsl.md)、[0008-dom-host-composition.md](./0008-dom-host-composition.md)、[0009-vite-authoring-integration.md](./0009-vite-authoring-integration.md)、[0012-package-boundaries.md](./0012-package-boundaries.md)

## 1. 决策

`examples/*` 中每个一级目录都是可独立启动的 workspace 包。首个包 `@domily/example-next-vite-todo` 的浏览器运行时依赖只有 `@domily/next`；Vite 集成作为独立开发依赖 `@domily/next-vite-plugin`。它从 core 的根与 `/author` 子路径取得运行时和作者 DSL，并从独立插件包取得 Vite 集成。

示例不直接依赖或装配 AST、loader、renderer、runtime、validator、host、codec 或 Vite adapter 的内部模块。它与真实业务工程一样只注册 capability，再将编译后的本地 AST 挂载到 DOM。

## 2. 责任边界

| 位置 | 内容 |
| --- | --- |
| `src/todo.dmy.ts` | 可序列化页面、状态、生命周期、受限动作与语义 view helper。 |
| `src/todo-service.ts` | 非序列化业务副作用和可信 capability；使用直接函数，无 `execute()` 包装。 |
| `vite.config.ts` | `domilyVite({ capabilities })`；由 capability 记录推导构建期 allowlist。 |
| `src/main.ts` | `createDomilyApp({ capabilities }).mount()`；不暴露 host 装配样板。 |
| `test/todo-example.test.ts` | 业务 capability 的公开函数契约回归；DSL/Vite 转换由生产 build 验证。 |

这使示例明确展示：DSL 不直接发请求、访问浏览器全局对象或执行闭包；所有副作用由 capability 提供，但业务方也不需要了解 `RuntimeCapability`、codec registry 或 DOM host 的内部形态。

## 3. 首个示例的范围

- 生命周期加载 Todo；
- input / submit / checkbox 事件；
- `derived` 控制 submit 禁用状态；
- `try/catch/finally` 的受限错误状态；
- 基于 key 的列表渲染；
- form、text field、button、alert、list、checkbox、page 的低样板作者 helper；
- Vite build-time 与运行时共享 capability 名称策略。

本例是本地 AST 页面，因此根入口不载入 JSON codec。服务端 envelope、签名和离线缓存使用 `@domily/next-codec-json` 的 `createDomilyJsonApp()`；它应作为独立远程交付示例演示，而不是为了本例简化而跳过 host 验证。

## 4. 验收

1. 示例 `dependencies` 中只有浏览器运行时 `@domily/next`；`@domily/next-vite-plugin` 仅位于 `devDependencies`；
2. Vite production build 产出无 DSL runtime import 的应用；
3. Todo 表单、列表、checkbox capability 可由直接函数契约回归覆盖；
4. 构建期 validator 与运行期 capability 记录来自同一份业务对象；
5. 不新增业务侧第三方运行时依赖；
6. 本地 AST 产物不包含 JSON codec、compiler 或 Vite adapter。
