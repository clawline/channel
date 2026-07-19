# 文档索引

当前仓库只保留这几份仍然有效的文档。

## 推荐阅读顺序

第一次接入建议按这个顺序看：

1. `../README.md`
2. `./INTEGRATION_GUIDE.md`
3. `./CONFIG_EXAMPLES_ZH.md`
4. `../examples/h5-client.html`

如果你是第三方集成方，直接从 `./INTEGRATION_GUIDE.md` 的“`0. 快速接入`”开始，不需要先读完整文档。

## 总览

- `../README.md`: 插件概述、能力列表、最小配置、快速开始

## 接入

- `./INTEGRATION_GUIDE.md`: H5 / 聊天 App / 微信小程序如何直接接 `clawline`，包括多 agent 列表与选择协议
- `../examples/h5-client.html`: 当前唯一保留的 H5 参考实现
- [clawline/gateway](https://github.com/clawline/gateway): relay 网关部署与环境变量说明

## 配置

- `./CONFIG_EXAMPLES.md`: English configuration examples
- `./CONFIG_EXAMPLES_ZH.md`: 中文配置示例

## 运行与测试

- `./PROACTIVE_DM.md`: 主动 DM 的使用方式
- `./E2E_TEST_CASES.md`: 当前真实 E2E 测试矩阵和结果

## 说明

已经删除的旧文档包括阶段性总结、旧版增强功能说明和过时的示例说明，避免后续接入继续跟着旧路径走。

当前真实接入主路径有两条：`websocket` 直连和 `relay` 转发。公网部署优先 `relay`，`webhook` 配置字段仍保留在 schema 中，但不属于当前主文档推荐路径，也不在当前已完成的 E2E 覆盖范围内。
