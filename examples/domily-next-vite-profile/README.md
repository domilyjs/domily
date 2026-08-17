# Domily Next + Vite Profile

这是第二个独立业务页面：一个多字段的资料设置表单。它只使用原始 `html.*`、可选的
`business.form` 预设和一个受信任的 `profile.save` capability；没有项目自定义 renderer、
资源加载器或工作流 DSL。

```sh
pnpm example:next-profile
```

[`src/profile.dmy.ts`](./src/profile.dmy.ts) 声明页面、字段、绑定和一次提交调用；
[`src/profile-service.ts`](./src/profile-service.ts) 持有保存后的状态并实现业务副作用；
[`src/main.ts`](./src/main.ts) 在应用启动时注册 native HTML、预设和 capability。

这个示例的 `profile.save` 明确只允许本地页面调用；若业务要接收远程 PageSpec，应在 capability
manifest 中单独开放 `remotePage`，并按真实 API 的身份与租户模型提供 `authorize()`。

它与 Todo 示例共用同一个 `@domily/next/business-form` 子路径，因此不增加运行时依赖。
