# E2E Test Cases

最后更新：2026-03-15

## 说明

这份文档是**完整测试矩阵**，不是只记录已执行用例的简表。

状态定义：

- `已通过`：已经实际执行并确认通过
- `未执行`：代码或页面支持，但本轮还没有完成 E2E 验证
- `未实现`：文档或 schema 中出现，但当前代码没有完整实现
- `暂不可观测`：代码路径存在，但当前协议下无法通过外部 E2E 稳定观测结果

## 连接与传输

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| WebSocket | 远端 WebSocket 建连 | 已通过 |
| WebSocket | `connection.open` 事件 | 已通过 |
| WebSocket | 手动断开连接 | 已通过 |
| WebSocket | 手动重新连接 | 已通过 |
| WebSocket | 异常断开后的自动重连 | 未执行 |
| WebSocket | 同一 `chatId` 多客户端同时连接 | 已通过 |
| WebSocket | 重连后 `history.sync` 回放 | 已通过 |
| WebSocket | 心跳保活 30s+ | 未执行 |
| Relay | 插件反连 `/backend` | 已通过 |
| Relay | 第三方客户端连接 `/client` | 已通过 |
| Relay | `healthz` 健康检查 | 已通过 |
| Relay | relay 路径下 token/chatId 不匹配返回标准 `1008` | 已通过 |
| Webhook | Webhook 模式接入 | 未实现 |
| Webhook | `webhookSecret` 校验 | 未实现 |

## 核心聊天

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| 直接消息 | DM 文本消息收发 | 已通过 |
| 群聊 | 群聊文本消息收发 | 已通过 |
| 回复 | `parentId` 引用回复 | 未执行 |
| 指令 | Slash Command 分发 | 未执行 |
| 长文本 | `textChunkLimit` 分片发送 | 已通过 |
| 思考状态 | `thinking.start` | 已通过 |
| 思考状态 | `thinking.update` | 未实现 |
| 思考状态 | `thinking.end` | 已通过 |

## 媒体消息

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| 图片 | 图片消息发送 | 已通过 |
| 图片 | 图片消息接收渲染 | 已通过 |
| 图片 | 图片预览后发送 | 已通过 |
| 图片 | 大图预览弹窗 | 已通过 |
| 图片 | 图片内容进入 Agent 上下文 | 已通过 |
| 语音 | 浏览器录音 | 已通过 |
| 语音 | 语音消息发送 | 已通过 |
| 语音 | 语音消息接收播放 | 已通过 |
| 音频 | 音频消息发送 | 已通过 |
| 音频 | 音频消息接收播放 | 已通过 |
| 音频 | 语音/音频内容进入 Agent 上下文 | 已通过 |
| 文件 | `messageType: "file"` 入站消息 | 已通过 |
| 文件 | 文件消息转发文本 fallback | 已通过 |

## 消息状态与消息管理

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| 状态回执 | `status.sent` | 已通过 |
| 状态回执 | `status.delivered` | 已通过 |
| 状态回执 | `status.read` | 已通过 |
| 状态回执 | `status.failed` | 暂不可观测 |
| 编辑 | `message.edit` | 已通过 |
| 删除 | `message.delete` 软删除 | 已通过 |
| 删除 | `message.delete` 硬删除 | 已通过 |
| 反应 | `reaction.add` | 已通过 |
| 反应 | `reaction.remove` | 已通过 |
| 置顶 | `message.pin` | 已通过 |
| 置顶 | `message.unpin` | 已通过 |
| 转发 | 文本消息转发 | 已通过 |
| 转发 | 图片消息转发 | 已通过 |
| 转发 | 语音/音频消息转发 | 已通过 |
| 转发 | 文件消息转发 | 已通过 |

## 输入状态与在线状态

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| Typing | `typing` 开始广播 | 已通过 |
| Typing | `typing` 结束广播 | 已通过 |
| Presence | `user.status = online` | 已通过 |
| Presence | `user.status = offline` | 已通过 |
| Presence | `user.status = away` | 已通过 |
| Presence | `user.status = busy` | 已通过 |
| Presence | 25s 心跳续期 | 已通过 |
| Presence | 30s 自动离线 | 已通过 |

## 文件传输

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| 文件传输 | `file.transfer` 初始化 | 已通过 |
| 文件传输 | `file.progress` 进度广播 | 已通过 |
| 文件传输 | `file.transfer` 完成态 | 已通过 |
| 文件传输 | `file.transfer` 失败态 | 已通过 |

## 群组能力

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| 群组 | `group.create` | 已通过 |
| 群组 | `member.add` | 已通过 |
| 群组 | `member.remove` | 已通过 |
| 群组 | `member.promote` | 已通过 |
| 群组 | `member.demote` | 已通过 |
| 群组 | `settings.update` | 已通过 |
| 群组 | `group.update` | 已通过 |
| 群组 | `group.delete` | 已通过 |

## 访问控制与配置

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| DM 策略 | `dmPolicy = open` | 已通过 |
| DM 策略 | `dmPolicy = allowlist` 允许 | 已通过 |
| DM 策略 | `dmPolicy = allowlist` 拒绝 | 已通过 |
| DM 策略 | `dmPolicy = pairing` | 已通过 |
| 历史上下文 | `historyLimit` 群聊上下文注入 | 未执行 |
| 配置 | `allowFrom` 生效 | 已通过 |
| 诊断 | `probeGeneric` 健康检查 | 已通过 |

## 多 Agent

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| Agent | `agent.list.get` 请求 agent 列表 | 已通过 |
| Agent | `agent.list` 返回 `id/name/default/model` | 已通过 |
| Agent | `agent.select` 切换当前连接 agent | 已通过 |
| Agent | `agent.selected` 返回确认结果 | 已通过 |
| Agent | 连接 URL `agentId` 预选 agent | 已通过 |
| Agent | 单条消息 `data.agentId` 显式覆盖 | 已通过 |
| Agent | 服务端自动路由回退到默认 agent | 已通过 |

## 多会话模型

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| Auth | token 仅绑定 `senderId` 建连 | 已通过 |
| Auth | 配置固定 `chatId` 的旧兼容模式 | 已通过 |
| 会话列表 | `conversation.list.get` 拉取当前用户会话列表 | 已通过 |
| 会话列表 | 按 `agentId` 过滤会话列表 | 已通过 |
| 历史 | `history.get` 拉取指定 `chatId` 历史 | 已通过 |
| 历史 | 固定 `chatId` + 显式 `agentId` 时，`history.sync` / `history.get` 只返回该 agent 的历史 | 已通过 |
| 连接模型 | 单一 WebSocket 连接订阅多个 `chatId` | 已通过 |
| H5 页面 | 会话栏切换不同 `chatId` | 未执行 |
| H5 页面 | 新建会话后正常收发 | 未执行 |

## H5 页面与增强功能

| 模块 | 测试案例 | 当前状态 |
| --- | --- | --- |
| H5 页面 | 页面连接远端 WebSocket | 已通过 |
| H5 页面 | 重新启动本地 `4173` 静态页后再次连接远端 WebSocket | 已通过 |
| H5 页面 | 页面发送文本并收到 AI 回复 | 已通过 |
| H5 页面 | “思考中”提示正常结束消失 | 已通过 |
| H5 页面 | 手动断开后不再误报“连接失败次数过多” | 已通过 |
| H5 页面 | 手动断开后再次手动连接 | 已通过 |
| H5 页面 | 错误地址切回正确地址后，旧重连不干扰当前连接 | 已通过 |
| H5 页面 | 历史消息展示 / 刷新后重连回放 | 已通过 |
| H5 页面 | Gateway 重启后重连历史回放 | 已通过 |
| H5 页面 | 历史连接列表 | 已通过 |
| H5 页面 | 图片按钮拉起文件选择器 | 已通过 |
| H5 页面 | 音频按钮拉起文件选择器 | 已通过 |
| H5 页面 | 图片选择与预览 | 已通过 |
| H5 页面 | 语音录音与预览 | 已通过 |
| 增强功能 | 表情反应 UI | 未实现 |
| 增强功能 | 消息编辑 UI | 未实现 |
| 增强功能 | 已读状态 UI | 未实现 |
| 增强功能 | Typing UI | 未实现 |
| 增强功能 | 转发 UI | 未实现 |
| 增强功能 | 在线状态 UI | 未实现 |
| 增强功能 | 文件进度 UI | 未实现 |
| 增强功能 | 搜索 UI | 未实现 |
| 增强功能 | 群组管理 UI | 未实现 |
| 增强功能 | 置顶/收藏 UI | 未实现 |

## 已确认通过的测试案例汇总

### 已通过

- 远端 WebSocket 建连
- `connection.open` 事件
- 手动断开连接
- 手动重新连接
- 同一 `chatId` 多客户端同时连接
- 重连后 `history.sync` 回放
- relay backend 反连 `/backend`
- 第三方客户端通过 relay `/client` 建连
- relay `healthz`
- relay 路径 token/chatId 不匹配返回 `1008`
- DM 文本消息收发
- 群聊文本消息收发
- `thinking.start`
- `thinking.end`
- `textChunkLimit` 分片发送
- 图片消息发送
- 图片消息接收渲染
- 图片预览后发送
- 大图预览弹窗
- 图片内容进入 Agent 上下文
- 浏览器录音
- 语音消息发送
- 语音消息接收播放
- 音频消息发送
- 音频消息接收播放
- 语音/音频内容进入 Agent 上下文
- `messageType: "file"` 入站消息
- 文件消息转发文本 fallback
- `status.sent`
- `status.delivered`
- `status.read`
- `message.edit`
- `message.delete` 软删除
- `message.delete` 硬删除
- `reaction.add`
- `reaction.remove`
- `message.pin`
- `message.unpin`
- 文本消息转发
- 图片消息转发
- 语音/音频消息转发
- 文件消息转发
- `typing` 开始广播
- `typing` 结束广播
- `user.status = online`
- `user.status = offline`
- `user.status = away`
- `user.status = busy`
- 25s 心跳续期
- 30s 自动离线
- `file.transfer` 初始化
- `file.progress` 进度广播
- `file.transfer` 完成态
- `file.transfer` 失败态
- `group.create`
- `member.add`
- `member.remove`
- `member.promote`
- `member.demote`
- `settings.update`
- `group.update`
- `group.delete`
- `dmPolicy = open`
- `dmPolicy = allowlist` 允许
- `dmPolicy = allowlist` 拒绝
- `dmPolicy = pairing`
- `allowFrom` 生效
- `probeGeneric` 健康检查
- `agent.list.get` 请求 agent 列表
- `agent.list` 返回 `main / code / writer`
- `agent.select` 切换当前连接 agent
- `agent.selected` 返回确认结果
- 连接 URL `agentId` 预选 agent
- 单条消息 `data.agentId` 显式覆盖
- token 仅绑定 `senderId` 建连
- 配置固定 `chatId` 的旧兼容模式
- `conversation.list.get` 拉取当前用户会话列表
- 按 `agentId` 过滤会话列表
- `history.get` 拉取指定 `chatId` 历史
- 单一 WebSocket 连接订阅多个 `chatId`
- 页面连接远端 WebSocket
- 重新启动本地 `4173` 静态页后再次连接远端 WebSocket
- 页面发送文本并收到 AI 回复
- “思考中”提示正常结束消失
- 手动断开后不再误报“连接失败次数过多”
- 手动断开后再次手动连接
- 错误地址切回正确地址后，旧重连不干扰当前连接
- 历史消息展示 / 刷新后重连回放
- Gateway 重启后重连历史回放
- 历史连接列表
- 图片按钮拉起文件选择器
- 音频按钮拉起文件选择器
- 图片选择与预览
- 语音录音与预览
- 测试机多 agent 配置生效：
  - `main`
  - `code`
  - `writer`
- 2026-03-15 本轮补测已确认：重启本地 `python3 -m http.server 4173` 后，`examples/h5-client.html` 仍可正常连接远端 `ws://wolf-sg.southeastasia.cloudapp.azure.com:18080/ws`，页面侧关键排查点是 `serverUrl`、token 对应的用户身份，以及浏览器 `localStorage` 中残留的历史连接配置。

## 当前结论

- 上一版文档只写了“已执行案例”，不够完整；本版已改为**完整能力测试矩阵**。
- 当前已经实际通过的是上面“已确认通过”的项目。
- 多 agent 协议已完成真实验证：远端测试机当前已配置 `main / code / writer`，前端可通过 `agent.list.get` 拉取列表，并通过 `agent.select` 切换当前连接目标 agent。
- 2026-03-15 本轮补测已确认：URL 查询参数 `agentId` 预选和单条消息 `data.agentId` 显式覆盖都已生效。
- 本轮远端日志显示：`data.agentId=writer` 的消息确实落到 `session=agent:writer:...`；同一连接上未显式覆盖、仅依赖连接级 `agentId=code` 的消息落到 `session=agent:code:...`。
- 2026-03-15 本轮远端 E2E 已确认“token 绑定用户 + 单连接多会话”模型可用：`test-multi` 可在同一连接下切换多个 `chatId`，`conversation.list.get` / `history.get` 可按当前用户正常返回，且固定 `chatId` 旧模式仍保持 403 拒绝行为。
- 2026-03-15 本轮还补测了按 `agentId` 过滤会话列表：`writer` 会话只出现在 `agentId=writer` 的列表里，不会误出现在 `agentId=main` 的列表里。
- 2026-03-15 本轮再次补测固定 `chatId` 账号 `test-full`：当连接 URL 显式带 `agentId=main` 或 `agentId=writer` 时，建连后的 `history.sync`、主动 `history.get`、以及 `conversation.list` 摘要都已按 `chatId + agentId` 隔离，不再混入其他 agent 的历史。
- 当前远端 `code` agent 的实际回复返回 provider 400，这说明本轮发现的是远端模型/调用兼容性问题，不是 clawline 的路由协议失效。
- 本轮已补完语音/音频链路的真实 E2E：浏览器麦克风录音、语音发送、音频文件发送、服务端媒体落盘与 Agent 上下文注入、以及 H5 接收侧对 `voice` / `audio` 的播放卡片渲染。
- 历史消息现已持久化到本地文件，gateway 重启后同一 `chatId` 重新连接仍可通过 `history.sync` 回放最近消息。
- 其余标记为 `未执行` 的能力，表示代码或页面支持，但这轮还没完成验证。
- 标记为 `未实现` 的能力，表示当前前端或服务端还没有完整代码路径，不能把它们算成“漏测”。
- 标记为 `暂不可观测` 的能力，表示当前外部协议下没有稳定的 E2E 观察口，需要额外诊断接口或行为改造后才能严谨验收。
