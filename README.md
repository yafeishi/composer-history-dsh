# Composer history for DeepSeek Harness

终端式的输入框历史：草稿为空时按 **↑** 逐条调出本会话已发送的消息，**↓** 向后翻，越过最新一条则清空草稿——和 shell 历史一样。

English: terminal-style input history for the chat composer. With an empty draft, `↑` recalls the previous message you sent in the current conversation, `↓` walks forward, and walking past the newest entry clears the draft.

## 特性 / Features

- 只在**草稿为空**时接管 ↑，草稿有内容时方向键行为不变
- 中文输入法组合期（IME composing）完全不打扰
- 只在当前会话内取历史，数据来自官方 `useConversation` 接口，无 DOM 抓取
- 通过官方 `inputActions.setDraft()` 写入草稿，与引用、附件、斜杠命令兼容

## 安装 / Install

在 DeepSeek Harness 里通过 Plugins → Add plugin 安装 Git 仓库：

```
git+https://github.com/yafeishi/composer-history-dsh
```

或克隆后从本地目录安装。

## 使用 / Usage

1. 在任意会话里发过几条消息
2. 点一下输入框，保持草稿为空
3. 按 `↑` 调出上一条，再按继续往前翻；`↓` 往回走，越过最新一条清空草稿

## 兼容性 / Compatibility

针对 DeepSeek Harness `0.2.x` 的 `conversation.input.overlay` 插槽与 `InputActions`/`useConversation` 标准接口开发。Harness 未来版本若调整这些接口，本插件可能需要更新。

## License

MIT
