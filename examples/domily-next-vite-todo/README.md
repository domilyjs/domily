# Domily Next + Vite Todo

这是原生 JavaScript/TypeScript + DOM 的最小业务示例。页面结构和事件连接写在一个普通
`.dmy.ts` PageSpec 中；业务数据、API 调用和项目组件实现仍是受信任的 TypeScript。

```sh
pnpm example:next-todo
```

## 五个业务入口

1. [`src/todo.dmy.ts`](./src/todo.dmy.ts)：易读的 PageSpec 配置。`definePage()` 只是类型帮助，不是宏或另一套 DSL。
2. [`src/todo-service.ts`](./src/todo-service.ts)：Host-owned `todo` scope、capability manifest/handler，以及项目自己的 `app.todoList` renderer。
3. [`src/main.ts`](./src/main.ts)：注册纯 manifest 与本地可信实现，再调用 `createPageHost().mount()`。
4. [`vite.config.ts`](./vite.config.ts)：`.dmy.ts` 交给 Vite 正常编译；插件只为 `.dmy.json` 的静态加载与可选构建期验证服务。
5. `@domily/next/business-form`：同一核心包内可 tree-shake 的可选预设；它把字符串草稿表单压缩为 `business.form` 配置，但不接管待办列表、请求或领域状态。

页面配置并不携带函数、DOM 节点、网络请求或状态机。比如表单提交只声明为一次 capability
调用；真正更新列表的逻辑由 `todos.create` handler 决定。这样远程 JSON 页面未来也只能组合已
部署的 catalog、renderer 和 capability，不能注入新代码。

`@domily/next` 是运行时唯一必装包；`@domily/next/business-form` 是它的子路径，不增加第二个运行时
依赖。Vite 插件只在开发依赖中。服务端 JSON 交付时按需增加 `@domily/next-codec-json`，其输出再交给
相同的 `normalizePageSpec()` 与 `PageHost`。
