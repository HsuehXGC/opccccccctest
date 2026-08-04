# Navo7 · 对外 API 接入文档

把你绑定的本地算力（Claude CLI）暴露成 **OpenAI 兼容** 的 HTTP 接口：第三方凭你签发的 API Key 调用，请求会路由到你**在线的机器**上真实运行 claude 并返回结果。

因为完全兼容 OpenAI 的 `/v1/chat/completions`，第三方可直接使用现成的 OpenAI SDK —— 只需把 `base_url` 换成 Navo7、`api_key` 换成你签发的 Key。

## 快速开始

1. 登录 Navo7 →「团队与账户 → 对外 API」。
2. 确认有**在线的本地算力**（本地算力区能看到机器在线、执行器为 claude）。
3. 点「生成 API Key」。默认是 **受限模式**（纯文本、禁工具）；只有勾选 **代理模式** 的 Key 才能让 claude 调用工具 / 执行命令。
4. 复制生成的 Key（`navo7-sk-…`，**只显示一次**），发给第三方。

## 认证

请求头带上 Key，二选一：

```
Authorization: Bearer navo7-sk-xxxxxxxx
```

```
x-api-key: navo7-sk-xxxxxxxx
```

## Base URL

```
https://navo7.com/v1
```

## 端点

### POST `/v1/chat/completions`

OpenAI 兼容的对话补全。常用请求字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 任意值即可，建议 `navo7-local`（实际模型由你机器上的 claude 决定） |
| `messages` | array | `[{ "role": "system" \| "user" \| "assistant", "content": "…" }]` |
| `stream` | boolean | `true` 则 SSE 流式返回；默认 `false` |

非流式响应（`chat.completion`）：

```json
{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "created": 1785882831,
  "model": "navo7-local",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "…" }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46 }
}
```

流式响应为标准 OpenAI `chat.completion.chunk` 事件，逐段 `data: {…}`，以 `data: [DONE]` 结束。

### GET `/v1/models`

返回可用模型列表（固定 `navo7-local`）。

## 两种模式

| 模式 | 行为 | 适用 |
| --- | --- | --- |
| **受限**（默认） | claude 禁用全部工具，纯文本对话，**不能在你机器上执行命令 / 读写文件 / 联网** | 对外开放、给第三方 |
| **代理** | claude 可调用工具、执行命令（权限极高） | 只发给完全信任的一方 |

模式在**生成 Key 时**决定，不可事后更改；换模式请新建 Key。

## 示例

### curl

```bash
curl https://navo7.com/v1/chat/completions \
  -H "Authorization: Bearer $NAVO7_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "navo7-local",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### Python（openai SDK）

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://navo7.com/v1",
    api_key="navo7-sk-xxxxxxxx",
)

resp = client.chat.completions.create(
    model="navo7-local",
    messages=[{"role": "user", "content": "一句话解释什么是 API"}],
)
print(resp.choices[0].message.content)
```

### Node（openai SDK）

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://navo7.com/v1",
  apiKey: process.env.NAVO7_API_KEY,
});

const resp = await client.chat.completions.create({
  model: "navo7-local",
  messages: [{ role: "user", content: "你好" }],
});
console.log(resp.choices[0].message.content);
```

### 流式（curl）

```bash
curl -N https://navo7.com/v1/chat/completions \
  -H "Authorization: Bearer $NAVO7_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"navo7-local","stream":true,"messages":[{"role":"user","content":"写一句诗"}]}'
```

## 错误

| HTTP | 含义 |
| --- | --- |
| 401 | API Key 无效或已撤销 |
| 400 | 请求体不合法（如 messages 为空） |
| 503 | 该账户当前没有在线的本地算力（claude 执行器） |
| 502 | 执行器执行出错或超时 |

错误体为 OpenAI 风格：`{ "error": { "message": "…", "type": "…" } }`。

## 注意事项

- **需要机器在线**：请求路由到你在线的机器；离线返回 503。多台在线时自动挑空闲的。
- **隐藏算力不参与**：标为「系统集成」的机器不会被对外 API 使用。
- **Key 是高权限密钥**：代理模式 Key 等同机器执行权，务必妥善保管；泄露立即在「对外 API」里撤销。
- **超时**：单次最长 10 分钟。
