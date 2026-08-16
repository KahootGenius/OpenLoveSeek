export const API_URL = 'https://api.deepseek.com/chat/completions';
// deepseek-chat/deepseek-reasoner aliases are removed 2026-07-24 (api-docs.deepseek.com).
export const DEFAULT_MODEL = 'deepseek-v4-flash' as const;
export const SUMMARIZER_MODEL = DEFAULT_MODEL;
export const HISTORY_BUDGET = 12000; // estimated tokens of verbatim history per request
export const SUMMARIZE_THRESHOLD = 20; // un-summarized msgs outside window before summarizer fires
export const NEW_CHAT_TITLE = '新对话';
export const TITLE_MAX = 40;

export const SUMMARY_PREFIX =
  '以下是此前对话的总结（供你参考，回复中不要提及总结本身）：\n';

// DEFAULT_SUMMARY_PROMPT moved to the prompt registry (prompts.ts,
// key 'summary.rolling') — customizable in the 提示词工作室.

export const SEED_PERSONA = {
  name: '助手',
  systemPrompt: '你是一个乐于助人的助手。',
};

export const LIFE_CATCHUP_HOURS = 6;
export const LIFE_IDLE_MINUTES = 10;
export const MOOD_HALF_LIFE_HOURS = 12;
export const MOOD_FLOOR = 0.15;
export const TRIGGER_CATCHUP =
  '[系统触发：用户离开了一段时间，刚刚回来。依据你的作息自然提及这段时间你做了什么，并主动延续或发起话题]';
export const TRIGGER_NUDGE =
  '[系统触发：基于当前时间与上下文，主动延续话题；若话题已尽或你不喜欢，自然地开启新话题]';

// 情绪曲线 (mood curve)
export const GROWTH_STEP_MAX = 0.1;
export const DRIFT_CAP = 0.3;
export const DRIFT_HALF_LIFE_DAYS = 14;
export const DRIFT_PRUNE_BELOW = 0.02;
export const GROWTH_RATE_LIMIT_MS = 24 * 3600000;
export const DEFAULT_MOOD_CURVE: Record<string, { openness: number; tone?: string }> = {
  清晨: { openness: 0.3, tone: '干脆务实' },
  上午: { openness: 0.4 },
  下午: { openness: 0.35, tone: '有点倦' },
  傍晚: { openness: 0.6, tone: '放松健谈' },
  深夜: { openness: 0.8, tone: '防备放下' },
};
