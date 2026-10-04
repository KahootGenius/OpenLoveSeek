# 模型服务商 (Providers) guide — DeepSeek or GLM

Her replies come from a chat model you bring your own key for. Since v2.9 you
can choose between **DeepSeek** and **GLM (智谱)** in 设置 → API Keys →
模型服务商. Both keys can be saved at the same time; only the selected
provider is ever called, and each remembers its own model choice.

## Which one?

| | DeepSeek | GLM |
|---|---|---|
| Models offered | flash = V4.1 Flash (cheap, default), v4-pro | 5.3-flash (cheap, default), 4.7, 5.3 (flagship), 4.7-flash (free) |
| Free tier | no | `glm-4.7-flash` — free but concurrency-limited; fine for a slow DM, expect 限流 under bursts |
| 思考 (thinking) | supported; DeepSeek's own default is ON at high effort, the app sends your toggle explicitly | supported; GLM's own default is ON. 5.3 / 5.3-flash can never turn it off: the toggle maps to `reasoning_effort` high (on) / low (off). Other GLM models switch it on/off |
| 想象力 (temperature) | 0.1–1.5 | API ceiling 1.0 — 奔放 (1.3) is clamped, so 奔放 ≈ 平衡 |
| Key | one platform | **region-bound**: 国际 `z.ai` key ≠ 国内 `open.bigmodel.cn` key |
| Top up | platform.deepseek.com | z.ai or open.bigmodel.cn, matching your key |

All utility calls (summaries, message cutting, marker repair, perception,
moments/group directors) automatically use the selected provider's cheapest
fast model that can run WITHOUT thinking (`deepseek-flash` /
`glm-4.7-flashx`) — the 5.3 family would reason on every one of them.

## Getting a GLM key

1. 国际: `z.ai` → API Keys. 国内: `open.bigmodel.cn` → 用户中心 → API Keys.
2. 设置 → API Keys → set **区域** to the platform you used, paste the key → 保存 → 测试连接.
3. Switch **模型服务商** to GLM. Pick a model in 设置 → 聊天 → 模型.

Keys live in the device's secure storage (same as DeepSeek/fal/MiniMax) and are
only sent to that provider's own endpoint. Backups never include keys.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "GLM API Key 无效或区域不匹配" | Key issued on the other platform, or wrong key | Match 区域 to where you created the key; re-save |
| "GLM 余额不足" | Account balance / resource package exhausted (GLM signals this as HTTP 429 code 1113) | Top up on the platform matching your key |
| "服务器繁忙（限流）" on the free model | `glm-4.7-flash` concurrency cap hit by a burst (cutter + repair + summary) | Pick `glm-5.3-flash`, or wait |
| "请求被拒绝：内容触发了 GLM 的安全策略" | GLM's content filter (code 1301) | Rephrase; GLM is stricter than DeepSeek on some themes |
| "请求被拒绝：…always uses think mode…" (pre-2026-09-14 builds) | The client sent `thinking.type: disabled` to a 5.3 model, which cannot switch thinking off | Fixed: 5.3 models now get `reasoning_effort` low/high instead; update the app |
| Replies feel less wild on GLM | Temperature clamp at 1.0 | Expected — see the table |
