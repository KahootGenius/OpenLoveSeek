# 语音 (Voice) guide

Her messages can be read aloud with MiniMax text-to-speech: tap-to-listen on
any of her messages, or optional auto-play while you're in the chat. Like
DeepSeek and fal.ai, this is BYO (bring your own) — you supply your own
MiniMax API key and it calls MiniMax directly from your device.

## 1. Get a MiniMax API key

1. Open MiniMax's platform in a browser: `platform.minimax.io` (Global) or
   `platform.minimaxi.com` (国内 / China).
2. Sign up / log in, then find the API Keys section and create a key.
3. In the app: 设置 → **MiniMax Key** → paste it → 保存.

The key is stored on-device (same secure storage as your DeepSeek/fal.ai
keys) and is only ever sent to MiniMax's own servers when you trigger a
朗读 or auto-play.

## 2. Create or clone a voice, and get its Voice ID

Voice **creation** happens on MiniMax's own website, not inside this app —
the app only ever plays audio for a `voice_id` you already own:

1. Open the same platform site as above (`platform.minimax.io` or
   `platform.minimaxi.com`).
2. Go to the 语音 / 音色克隆 (voice cloning) playground.
3. Generate a new voice, or clone one from a sample recording.
4. Copy that voice's **voice_id**.
5. Paste it into the app (see §3 below).

Every screen in the app with a Voice ID field has a ⓘ button next to it
that repeats this guidance.

## 3. Region binding — read this before you paste a key or a voice_id

A MiniMax key and a voice_id are each tied to whichever platform they were
issued on. An 国际 (Global) key cannot use a 国内 (CN) voice_id, and vice
versa — mixing them fails with an authentication error (see the
troubleshooting table below). Make sure 设置 → **区域** matches whichever
platform you actually created your key and your voice on.

## 4. Where to put the voice_id: global default vs per-persona

- 设置 → **默认 Voice ID** — the fallback voice used for any persona that
  doesn't have its own. Set this once and every DM can speak.
- 人设编辑 (persona editor) → **声音** — an optional override for one
  specific persona, so different characters can sound different. Leave it
  blank to fall back to the global default above. This field only appears
  once the persona has already been created (same as 形象设定 below it).

A persona can only speak if the *effective* voice_id (its own override, or
the global default when it has none) is non-empty.

## 5. All the settings, explained

All of these live in 设置, in the 语音 section:

| Setting | What it does |
|---|---|
| **语音功能** | Master switch. Nothing is ever sent to MiniMax while this is off. |
| **区域** | 国际 (Global) or 国内 (CN) — must match your key and voice_id (§3). |
| **默认 Voice ID** | The global fallback voice_id (§4). |
| **语速** | Playback speed, 0.5–2.0 (1.0 = normal). |
| **自动朗读** | When on, her new completed replies play automatically **while you have the chat open and focused** — switching away or leaving the chat stops playback; anything she sent while you were away queues up and plays back in order when you return to the chat (capped by your daily limit, like everything else). A long reply that's split into several bubbles plays them back to back, in order. |
| **括号内容也朗读** | （…）stage-direction asides are skipped by default; turn this on to have them read too (the parentheses themselves are never read, just the words inside). |
| **每日字符上限** | A shared daily cap (across all chats) on how many characters get sent to MiniMax, so a runaway auto-play session can't surprise you with a large bill. Resets at midnight. |

情绪跟随 (emotion) is automatic and has no separate toggle: her current
mood is mapped to MiniMax's emotion parameter whenever it's recognized
(开心/难过/生气/平静/惊讶/害怕/厌恶 and close synonyms); an unrecognized or
unset mood just omits it and MiniMax picks a neutral delivery.

## 6. Using it

- **朗读** — long-press any of her text messages and choose 朗读. The first
  play calls MiniMax and caches the audio; replaying the same message again
  later is free (it reuses the cached file instead of calling MiniMax again).
- **自动朗读** — see the table above. Off by default.

## 7. Cost

朗读 and 自动朗读 both call MiniMax's TTS API and are billed per character
against your own MiniMax account balance — check MiniMax's own pricing
page for current rates. A cache hit (replaying something already spoken)
never calls MiniMax again and costs nothing. The 每日字符上限 setting is a
safety net, not a substitute for checking MiniMax's pricing yourself.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Error mentioning a Key/region problem (MiniMax code 1004) | Your key is invalid, or your key and voice_id were issued on different platforms (国际 vs 国内) | Re-check 设置 → MiniMax Key is saved correctly, and that 区域 matches the platform you actually got the key AND the voice_id from |
| "请求太多，请稍后再试" (rate limited, code 1002/1039) | Too many requests in a short time — easy to hit with 自动朗读 on a busy chat | Wait a bit and try again; consider turning 自动朗读 off if it happens often |
| "文本包含过多无效字符" (code 1042) | The message text has characters MiniMax's TTS can't handle | Usually harmless/rare; try 朗读 on a different message, or report it if it happens constantly |
| No sound at all, no error | One of the gates below is off | Check, in order: 设置 → 语音功能 is on; a Voice ID is actually set (either 默认 Voice ID in 设置, or this persona's own 声音 field); MiniMax Key is saved; 每日字符上限 hasn't already been used up today |
| 朗读 shows up on some messages but not others | 朗读 only appears on her own text replies | Stickers, transfers, photos, game results, and your own messages don't offer 朗读 |
