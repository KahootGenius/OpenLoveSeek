# LoveSeek

**A local-first AI companion app powered by DeepSeek.** Design a character, and she chats with you, remembers your history together, keeps her own daily schedule and moods, posts Moments, plays games with you, sends you photos, reads her messages aloud — and sometimes texts you first.

Built with Expo / React Native (Android-focused). The UI is in Simplified Chinese (简体中文). There is no backend, no account, and no telemetry: every message, memory, persona, photo, and voice clip lives on your phone, your API keys live in the system secure keystore, and the only network traffic is direct HTTPS calls to the providers you choose to enable — DeepSeek for chat (required), and optionally fal.ai for photos and MiniMax for voice — each paid for by your own key.

[中文简介见文末](#中文简介)

## Features

**Chat**
- Token-streaming replies (SSE) with DeepSeek chat, optional thinking mode, and a model picker
- Long replies are cut into natural multi-message bursts (消息切割) instead of one wall of text
- Repetition/verbal-tic detection (复读检测) and 变化检测 rut nudges catch the model looping its favorite phrases or reply shapes
- Long-press any message for a proper action menu — reply, copy, read aloud, delete or recall — where a denied action shows greyed out with the reason instead of silently disappearing
- Markdown rendering, stickers, mini-games (dice, rock-paper-scissors), in-chat transfers, pats
- 开启新篇章 — start a fresh context mid-relationship, carrying the last few messages so it doesn't open cold
- 上下文长度 — a context-budget knob (a number, or 短/中/长 presets) sets how much history each turn sends; a chat inspector shows exactly what she saw

**Characters (人设)**
- Persona editor with few-shot 示例对话 slots — a *good* example teaches her how to sound, a *bad* one marks what she must never sound like
- 提示词工作室 (Prompt Studio): every system prompt the app uses lives in an editable registry — nothing is hardcoded away from you
- Long-term memory: rolling summaries plus explicit extracted memories you can view, edit, and delete right from the chat; deleting a message resets the stored context with it
- 情绪曲线 (mood curve): time-of-day openness and tone, with slow growth and decaying drift across days
- A daily life schedule (作息): she's busy at some hours and relaxed at others, and catches you up on what she did while you were away
- 形象设定 (appearance) and a per-character voice, which feed the photo and voice features below

**Photos (照片)** — optional, bring your own [fal.ai](https://fal.ai) key
- From a written appearance, the app generates three frozen Seedream reference portraits (redo or freeze each one) so she looks the same in every picture
- She decides when to send a photo mid-chat: a selfie conditioned on her reference set, or a 实拍 shot of what she's looking at (food, scenery, the cat) with no one in frame
- Pending / failed / retry bubbles, and a daily per-conversation cap you set

**Voice (语音)** — optional, bring your own [MiniMax](https://platform.minimax.io) key
- Tap any of her messages to hear it, or turn on auto-play while the chat is in the foreground; message bursts queue in order
- Her tone follows her current mood; Global and 国内 regions; one default voice plus per-character voice IDs
- A daily character cap, a per-message audio cache, and stage directions in （brackets） skipped by default — setup walkthrough in [`seekchat/VOICE.md`](seekchat/VOICE.md)

**Community**
- 朋友圈 (Moments): characters author their own posts, like and comment on yours, and reply to your comments; diary entries feed their inner life
- Group chat: multiple characters in one room, a lightweight "director" call decides who speaks, and @-mentions (with a picker) guarantee a reply
- Group hierarchy: Owner > Admin > Member with rank-checked 禁言 / 撤回 / 公告 / 群笔记 actions; an owner character can appoint or dismiss admins, remove members, and hand ownership back to you — every action lands as a system line in the transcript
- 群红包 red packets, named typing indicators, join/leave reactions, group avatars — and what happens in the group carries home into each 1:1 relationship

**Proactive**
- 主动消息 (outreach): the app pre-writes a few of her messages and hands them to the OS as scheduled notifications, so she can text you first even on Chinese ROMs that freeze apps in the background

**Special modes** — off by default, per character, consent-gated
- 病娇 (yandere) mode: a character written as jealous or clingy can occasionally act it out on the device — a short vibration, a "don't go" banner, a full-screen in-app lock, a phrase she demands you type before leaving, and asking her permission before you go back to the chat list
- Master mode: a dominance/obedience layer for consenting adult roleplay — the character sets her own honorific and up to eight rules, issues commands you acknowledge with a tap, sets a reply countdown, and keeps a 0–100 "discipline" score; its device-level actions are the same set as yandere mode

Both are disabled for every character until you switch them on in that character's editor, and each switch opens its own consent dialog with a tick box and a five-second countdown before 确认 unlocks. Neither can be turned on by the model, and neither is enabled by default anywhere. What makes them safe to try:
- **Every action is an in-app overlay.** The app declares no overlay, device-admin, or accessibility permissions. The lock screen uses the phone's own biometric/PIN prompt via `expo-local-authentication` and unlocks immediately if none is enrolled. The Android home button is never intercepted — you can always leave the app — and the demand screen says so on-screen.
- **Hard caps live in code, not in the prompt.** The lock fires at most once per cooldown (30 minutes by default, adjustable per character), the "don't go" banner clears itself after 90 seconds, reply countdowns are clamped to 3–120 seconds, and a lock the character merely *narrates* does nothing — only an exact marker on its own line counts.
- **Nothing extra leaves the device.** These modes send no additional data anywhere; they only interpret markers in a reply DeepSeek has already returned.
- **Off is one switch away**, and the setting applies only to the character you enabled it on.

**Data & safety**
- Full export/import backups (zip); an automatic safety export is written before any restore
- Biometric app lock
- Daily API usage counter, temperature presets, and separate daily caps for photos and voice
- Settings grouped into API Keys / 聊天 / 照片 / 语音 sections

## How it works

LoveSeek is a pure client. You bring your own DeepSeek API key (get one at [platform.deepseek.com](https://platform.deepseek.com)), enter it in 设置 (Settings), and it is stored with `expo-secure-store`. Photos and voice are off by default; each turns on only after you add a fal.ai or MiniMax key of your own, stored the same way, and each calls its provider directly from the device. All prompt assembly — persona, memories, mood, schedule, examples — happens on-device; deterministic rules (caps, throttles, marker parsing, permission checks) are enforced in code rather than trusted to the model.

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
  src/components/             shared UI — message menu, reference gallery, chat inspector, …
  src/lib/                    logic modules — pure functions where possible
  src/__tests__/              jest test suites
  modules/loveseek-native/    Android keep-alive native module (Kotlin)
  scripts/                    local APK build + API smoke test
  VOICE.md                    MiniMax voice setup guide
tools/sticker-packer.html     browser-based sticker pack builder
```

## Tests

```bash
cd seekchat
npm test
```

## License & disclaimers

MIT — see [LICENSE](LICENSE).

LoveSeek is an independent project, not affiliated with or endorsed by DeepSeek, fal.ai, ByteDance (Seedream), or MiniMax. You use your own API keys and pay for your own usage. Companion characters are roleplay driven by a language model — enjoy them for what they are.

---

## 中文简介

LoveSeek 是一个**本地优先**的 AI 陪伴应用，基于 DeepSeek API，用 Expo / React Native 构建（面向 Android）。

- **无服务器、无账号、无数据上报**：聊天记录、记忆、人设、照片、语音全部存在手机本地；API Key 存在系统安全存储；网络请求只直连你自己启用的服务商——DeepSeek（聊天，必需），以及可选的 fal.ai（照片）与 MiniMax（语音）。
- **功能**：人设与提示词工作室、示例对话（好例/坏例）、长期记忆与滚动总结、情绪曲线与作息、朋友圈与角色日记、群聊（群主/管理员/成员体系，禁言/撤回/公告/群笔记，群红包，@提及）、主动消息（利用系统定时通知绕过后台冻结）、Seedream 照片（自拍与实拍）、MiniMax 语音朗读、消息切割与复读/变化检测、长按消息菜单、上下文长度调节、表情包、小游戏、转账与拍一拍、备份导出/导入、生物识别应用锁、用量计数等。
- **特殊模式（可选）**：病娇模式与主人模式默认关闭，需在单个角色的编辑页手动开启并勾选确认（5 秒倒计时）。所有"越界"行为都只是应用内的遮罩——震动、需指纹/密码解开的锁定画面、挽留横幅、索求打字画面；应用不申请悬浮窗、设备管理或无障碍权限，Home 键随时可退出，锁屏有冷却时间、挽留 90 秒自动解除，也不会额外上传任何数据。
- **上手**：`cd seekchat && npm install && npx expo start`，在设置中填入你自己的 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请）；照片与语音为可选功能，分别需要你自己的 fal.ai 与 MiniMax Key。打包 APK 见 [`seekchat/BUILD.md`](seekchat/BUILD.md)，语音设置见 [`seekchat/VOICE.md`](seekchat/VOICE.md)。

本项目与 DeepSeek、fal.ai、MiniMax 官方无关；MIT 协议开源。
