export type Role = 'user' | 'assistant';
export type GroupRole = 'admin' | 'member';
export type MessageStatus = 'complete' | 'interrupted';
export type MessageKind =
  | 'normal' | 'trigger' | 'pat' | 'sticker' | 'meta' | 'game' | 'transfer' | 'experience'
  | 'recall' | 'redpacket' | 'image' | 'voice';
export type DeliveryMode = 'typewriter' | 'simulated';
// 模型服务商 (v2.9): the user picks one; keys, model prefs and endpoints are
// all resolved per provider (providers.ts / settings.ts).
export type Provider = 'deepseek' | 'glm';
export type DeepSeekModelId = 'deepseek-flash' | 'deepseek-v4-pro'; // deepseek-flash = V4.1 Flash (2026-09-10)
export type GlmModelId = 'glm-5.3-flash' | 'glm-4.7' | 'glm-5.3' | 'glm-4.7-flash' | 'glm-4.7-flashx';
export type ModelId = DeepSeekModelId | GlmModelId;

export interface Persona {
  id: string;
  name: string;
  systemPrompt: string;
  summaryPrompt: string | null;
  avatarUri: string | null; // data: URI (resized base64 jpeg) or null
  proConfig: string | null; // JSON ProConfig (schema v3) or null
  appearancePrompt: string | null; // 照片 (schema v17): her look, for ref-image generation
  refsFrozen: number; // 0 | 1 — once frozen, ref_images are fixed until 清空重来 (schema v17)
  voiceId: string | null; // 语音 (schema v18): her MiniMax voice_id; null falls back to the global default
  shaping: string | null; // 立即开始 (schema v19): JSON ShapingState while she shapes herself; null = ordinary persona
  dayLog?: string | null; // 真实感 (schema v20): JSON DayLog — today's generated small events
  createdAt: number;
  updatedAt: number;
}

export interface Character {
  id: string;
  personaId: string;
  homeConvoId: string; // the 1:1 chat that IS her soul (approach B, v2 spec §4)
  soulSync: number; // 0 | 1 (sqlite boolean) — carry community experiences home
  createdAt: number;
  updatedAt: number;
}

export type PostType = 'moment' | 'diary';

export interface PostImage {
  uri: string; // data: URI (720px JPEG), same self-contained pattern as stickers
  desc: string; // what characters "see" — required, like sticker descriptions
}

export interface Post {
  id: string;
  authorType: 'user' | 'character'; // character posts arrive in v2.3
  authorId: string | null; // characterId when authorType='character'
  text: string;
  images: string; // JSON PostImage[]
  postType: PostType;
  visibility: string; // 'all' | JSON characterId[]
  chatReadable: number; // 0|1 — diary only: discussable in the 1:1 chat
  createdAt: number;
}

export interface Reaction {
  id: string;
  postId: string;
  characterId: string; // '' sentinel for user rows (schema v14, FKs unenforced)
  authorType: string; // 'character' | 'user' (schema v14)
  type: 'like' | 'comment';
  content: string | null; // null for likes
  revealAt: number; // feed shows the reaction once now >= revealAt
  notifId: string | null; // scheduled OS notification, for cancellation
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  personaId: string;
  summary: string | null;
  summaryUpToId: string | null;
  lifeEnabled: number; // 0 | 1 (sqlite boolean)
  memoryEnabled: number; // 0 | 1 — 记忆库 injection + write channel (schema v8)
  moodLabel: string | null;
  moodIntensity: number | null;
  moodUpdatedAt: number | null;
  currentThought: string | null;
  curveDrift: string | null; // JSON CurveDrift (schema v4) or null
  discipline: number | null; // 主人 mode obedience 0..100 (schema v6); null = unstarted
  masterHonorific: string | null; // character-authored required address (schema v7)
  masterRules: string | null; // character-authored rules, newline-joined (schema v7)
  charBalance: number | null; // 转账 wallet (schema v10); null = seed from persona initBalance
  avatarUri: string | null; // group portrait (schema v15); DMs keep null
  kind: string; // 'dm' | 'group' (schema v13)
  groupConfig: string | null; // JSON GroupConfig, groups only (schema v13)
  agenda?: string | null; // 想聊 (schema v20): the thing she wants to bring up
  closeness?: number | null; // 亲密度 0..100 (schema v20); null = CLOSENESS_START
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  status: MessageStatus;
  kind: MessageKind;
  reasoning: string | null; // thinking-mode chain, when captured (schema v5)
  quotedId: string | null; // 引用: the message this one replies to (schema v9)
  speakerId: string | null; // group speaker (characterId); null = user / DM (schema v13)
  readAt?: number | null; // 已读 (schema v20): user rows — when she reads it; null = not stamped
  createdAt: number;
}

export interface MemoryEntry {
  id: string;
  conversationId: string;
  text: string; // one durable fact/moment, model-authored (schema v8)
  followUpAt?: number | null; // 跟进 (schema v20): bring it up on/after this time; null = plain memory
  createdAt: number;
}

export interface Sticker {
  id: string;
  label: string; // what the model reads and emits
  desc: string; // verbal description injected into the prompt
  image: string; // data: URI
  createdAt: number;
}

// 照片 (schema v17): one of a persona's 3 frozen reference-image slots.
export interface RefImage {
  id: string; // deterministic `${personaId}:${slot}`
  personaId: string;
  slot: number;
  uri: string; // local file uri — never a fal URL directly persisted
  prompt: string; // the composeRefPrompts() text that generated it
  createdAt: number;
}

export interface ApiMessage {
  role: 'system' | Role;
  content: string;
}
