export type Role = 'user' | 'assistant';
export type GroupRole = 'admin' | 'member';
export type MessageStatus = 'complete' | 'interrupted';
export type MessageKind =
  | 'normal' | 'trigger' | 'pat' | 'sticker' | 'meta' | 'game' | 'transfer' | 'experience'
  | 'recall' | 'redpacket' | 'image';
export type DeliveryMode = 'typewriter' | 'simulated';
export type ModelId = 'deepseek-v4-flash' | 'deepseek-v4-pro';

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
  createdAt: number;
}

export interface MemoryEntry {
  id: string;
  conversationId: string;
  text: string; // one durable fact/moment, model-authored (schema v8)
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
