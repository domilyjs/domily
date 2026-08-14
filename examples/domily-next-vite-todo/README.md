# Domily Next + Vite Todo

这是一个业务工程最小示例：浏览器运行时只安装 `@domily/next`；Vite transform 作为开发依赖安装 `@domily/next-vite-plugin`。页面、状态、生命周期和受限交互写在 `.dmy.ts`；业务副作用保留在普通 TypeScript capability 中。

```sh
pnpm example:next-todo
```

根脚本会先构建 Domily Next，再启动 Vite。也可以分别执行：

```sh
pnpm run build:next
pnpm --filter @domily/example-next-vite-todo run dev
```

## 业务侧的三个入口

```ts
// src/main.ts
import { createDomilyApp } from '@domily/next';
import document from './todo.dmy.ts';

void createDomilyApp({ capabilities }).mount(document, '#domily-root');
```

```ts
// src/todo.dmy.ts
import { action, cap, defineDocument, ref, state, view } from '@domily/next/author';
```

```ts
// vite.config.ts
import { domilyVite } from '@domily/next-vite-plugin';
```

前两个入口属于 `@domily/next`：根入口只含浏览器运行时，`/author` 会被静态编译擦除。第三个入口属于独立开发包 `@domily/next-vite-plugin`，它只在 Node/Vite 进程中加载。业务产物不会带入 author DSL、compiler 或 Vite adapter。

## 阅读顺序

1. [`src/todo.dmy.ts`](./src/todo.dmy.ts)：页面、状态、生命周期与受限动作；使用 `view.page/form/textField/list/checkbox` 等声明式 helper。
2. [`src/todo-service.ts`](./src/todo-service.ts)：可信业务 capability；它是唯一应放 API、认证、数据库或业务校验的地方。
3. [`vite.config.ts`](./vite.config.ts)：`domilyVite({ capabilities })` 从同一份 capability 记录推导构建期策略。
4. [`src/main.ts`](./src/main.ts)：`createDomilyApp()` 以本地 AST 挂载页面，不再装配 codec、store、registry 或 host。

## 本地与远程文档

本例是本地 DSL/AST 页面，所以使用最小根入口和独立的 Vite 开发依赖。服务端下发 JSON envelope 时，额外安装 `@domily/next-codec-json`：

```ts
import { createDomilyJsonApp } from '@domily/next-codec-json';

const app = createDomilyJsonApp({ capabilities, fetchEnvelope, verifyEnvelope });
await app.mountRemote('todos', '#domily-root');
```

这样本地 AST 页面无需把 JSON codec 带入浏览器；远程交付仍使用 JSON codec、hash、签名与 IndexedDB/Memory cache 的既有安全边界。
