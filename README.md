# LoveSeek

**A local-first AI companion app powered by DeepSeek.** Design a character, and she chats with you, remembers your history together, keeps her own daily schedule and moods, posts Moments, plays games with you — and sometimes texts you first.

Built with Expo / React Native (Android-focused). The UI is in Simplified Chinese (简体中文). There is no backend, no account, and no telemetry: every message, memory, and persona lives in a SQLite database on your phone, your DeepSeek API key lives in the system secure keystore, and the only network traffic is HTTPS calls to `api.deepseek.com` — paid for by your own key.

[中文简介见文末](#中文简介)

## Features

**Chat**
- Token-streaming replies (SSE) with DeepSeek chat, optional thinking mode, and a model picker
- Long replies are cut into natural multi-message bursts (消息切割) instead of one wall of text
- Repetition/verbal-tic detection (复读检测) catches the model looping its favorite phrases
- Markdown rendering, stickers, mini-games (dice, rock-paper-scissors), in-chat transfers, pats
- 开启新篇章 — start a fresh context mid-relationship, carrying the last few messages so it doesn't open cold

**Characters (人设)**
- Persona editor with few-shot 示例对话 slots — a *good* example teaches her how to sound, a *bad* one marks what she must never sound like
- 提示词工作室 (Prompt Studio): every system prompt the app uses lives in an editable registry — nothing is hardcoded away from you
- Long-term memory: rolling summaries plus explicit extracted memories you can view, edit, and delete
- 情绪曲线 (mood curve): time-of-day openness and tone, with slow growth and decaying drift across days
- A daily life schedule (作息): she's busy at some hours and relaxed at others, and catches you up on what she did while you were away

**Community**
- 朋友圈 (Moments): characters author their own posts, like and comment on yours, and reply to your comments; diary entries feed their inner life
- Group chat: multiple characters in one room, a lightweight "director" call decides who speaks, @-mentions guarantee a reply — and what happens in the group carries home into the 1:1 relationship

**Proactive**
- 主动消息 (outreach): the app pre-writes a few of her messages and hands them to the OS as scheduled notifications, so she can text you first even on Chinese ROMs that freeze apps in the background

**Data & safety**
- Full export/import backups (zip); an automatic safety export is written before any restore
- Biometric app lock
- Daily API usage counter, temperature presets, adjustable context budget

## How it works

LoveSeek is a pure client. You bring your own DeepSeek API key (get one at [platform.deepseek.com](https://platform.deepseek.com)), enter it in 设置 (Settings), and it is stored with `expo-secure-store`. All prompt assembly — persona, memories, mood, schedule, examples — happens on-device; deterministic rules (caps, throttles, marker parsing) are enforced in code rather than trusted to the model.

## Getting started

Requirements: Node 20+, npm.

```bash
cd seekchat
npm install
npx expo start
```

Most features work in Expo Go; the custom keep-alive native module requires a development build or an APK. To build an installable APK with your own Expo account and keystore, see [`seekchat/BUILD.md`](seekchat/BUILD.md):

```bash
npm run build:apk
```

## Sticker packs

Characters can send stickers from packs you import as a zip: images plus a `stickers.json` manifest —

```json
[
  { "file": "happy.jpg", "label": "开心", "desc": "开心地笑" }
]
```

`label` (≤20 chars) is what the model "sends"; `desc` tells it when the sticker fits. [`tools/sticker-packer.html`](tools/sticker-packer.html) is a standalone drag-and-drop pack builder that runs in your browser — no install needed.

## Project structure

```
seekchat/                     the Expo app
  src/app/                    screens (expo-router file routing)
  src/lib/                    logic modules — pure functions where possible
  src/__tests__/              jest test suites
  modules/loveseek-native/    Android keep-alive native module (Kotlin)
  scripts/                    local APK build + API smoke test
tools/sticker-packer.html     browser-based sticker pack builder
```

## Tests

```bash
cd seekchat
npm test
```

## License & disclaimers

MIT — see [LICENSE](LICENSE).

LoveSeek is an independent project, not affiliated with or endorsed by DeepSeek. You use your own API key and pay for your own usage. Companion characters are roleplay driven by a language model — enjoy them for what they are.

---

## 中文简介

LoveSeek 是一个**本地优先**的 AI 陪伴应用，基于 DeepSeek API，用 Expo / React Native 构建（面向 Android）。

- **无服务器、无账号、无数据上报**：聊天记录、记忆、人设全部存在手机本地 SQLite；API Key 存在系统安全存储；唯一的网络请求是直连 `api.deepseek.com`。
- **功能**：人设与提示词工作室、示例对话（好例/坏例）、长期记忆与滚动总结、情绪曲线与作息、朋友圈与角色日记、群聊与 @提及、主动消息（利用系统定时通知绕过后台冻结）、表情包、小游戏、转账与拍一拍、病娇模式、备份导出/导入、生物识别应用锁、用量计数等。
- **上手**：`cd seekchat && npm install && npx expo start`，在设置中填入你自己的 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请）。打包 APK 见 [`seekchat/BUILD.md`](seekchat/BUILD.md)。

本项目与 DeepSeek 官方无关；MIT 协议开源。
