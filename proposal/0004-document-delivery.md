# 0004：服务端文档交付、验证与离线缓存职责

- 状态：已确认
- 日期：2026-08-12
- 关联：[0001-schema-driven-ui.md](./0001-schema-driven-ui.md)、[0002-document-codecs.md](./0002-document-codecs.md)

## 1. 要解决什么

“服务端下发、离线缓存”不只是把 JSON 放到一个 URL。客户端必须知道以下信息：

- 当前拿到的是哪一份文档，是否需要更新；
- 网络返回是否来自可信的发布系统，是否被篡改；
- 离线时能否继续使用旧文档，使用多久；
- 新版本到达时是在本次会话热更新、下次打开更新，还是必须立即失效。

这些是 **文档交付层** 的职责，不属于 UI AST、动作或 renderer。

## 2. 具体例子

假设某应用加载 `orders/create` 页面：

1. App Shell 请求配置平台：`GET /documents/orders/create`；
2. 服务返回 payload、codec、`revision: 42`、`contentHash` 和可选签名；
3. 客户端校验响应元数据、签名/哈希、codec 和 AST；
4. 客户端把原始 payload 与已验证 AST 都缓存；
5. 用户断网后再打开页面：使用已验证的 revision 42；
6. 服务发布 revision 43：客户端按策略在后台拉取；校验通过后写入缓存；
7. 旧 revision 42 如何处理，取决于缓存淘汰策略：可以继续当前会话，下一次进入页面切换；也可以在安全修复时立即废弃。

所以“由哪个宿主系统负责”是在问职责归属，而不是让 UI 文档自己保存缓存。例如：配置平台负责签发版本和签名；App Shell/Document Loader 负责下载、验证、缓存和选择当前版本；业务页面 runtime 只接收已经验证的 AST。

## 3. 建议的职责分离

| 部分 | 建议责任 |
| --- | --- |
| 配置发布服务 | 为文档生成 `id`、`revision`、`contentHash`；按需要用发布密钥签名；提供 manifest/拉取接口。 |
| App Shell / Document Loader | 按来源拉取、校验元数据及签名、选择 codec、解析/校验/migrate、保存 raw payload 和 AST、执行缓存策略。 |
| Domily Next Runtime | 只 mount 已验证 AST；执行组件/capability 权限检查；不知道 HTTP、CDN 和具体缓存介质。 |
| 宿主安全策略 | 定义哪些 endpoint、签名公钥、codec、document ID 和 capability 可被该应用使用。 |

这是推荐拆分；如果项目暂时没有独立配置平台，MVP 可以由 playground/app shell 同时承担“发布服务模拟”和 loader，但接口不能把这两项职责写死在 runtime。

## 4. 推荐的交付 envelope

UI AST 不包含交付元数据。服务端将它包在独立 envelope 中：

```json
{
  "id": "orders/create",
  "revision": 42,
  "codec": "json",
  "contentHash": "sha256-...",
  "issuedAt": "2026-08-12T10:00:00Z",
  "cache": {
    "maxAgeSeconds": 86400,
    "staleWhileRevalidateSeconds": 604800
  },
  "payload": "{...}",
  "signature": "base64url-optional-signature"
}
```

`payload` 的具体形态由 codec 决定：JSON/TOON/YAML/TOML 用文本，BSON 用字节。`contentHash` 对 payload 原始字节求值；`signature` 覆盖关键元数据和哈希。文档 AST 内部仍只有 UI 语义，因而同一文档可以在本地 DSL 编译、服务端 JSON、或未来 TOON 表示中复用。

## 5. MVP 的最小范围

MVP 不需要签名服务、CDN 或后台热更新，但 loader 接口必须接受 envelope，并实现：

1. `id`、整数 revision、codec 和 `contentHash`；
2. memory/IndexedDB 的缓存存储抽象；
3. 同时保存 raw payload 和已验证 AST；
4. 离线优先：若缓存文档仍在宿主允许的 `maxAge` 内，优先 mount 缓存并后台刷新；
5. 校验失败时不覆盖最后一个已验证版本；
6. 签名验证保留 `verifyEnvelope` 注入接口，默认可由本地开发策略跳过。

## 6. 已确认的实现边界

确认采用以下职责归属：**配置发布服务负责 revision/hash/可选签名，App Shell 的 Document Loader 负责获取/验证/缓存，Domily Next Runtime 只运行已验证 AST。**

MVP 先实现没有远程后端的 `MemoryDocumentStore` / `IndexedDbDocumentStore` 和可注入 `verifyEnvelope`；正式配置平台、CDN、后台热更新及签名密钥管理后续接入。
