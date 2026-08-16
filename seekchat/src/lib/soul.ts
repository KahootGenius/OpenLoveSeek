// The character's home-chat context, shared by moments reactors (feed.ts)
// and group speakers (groupflow.ts). Spec §4: the 1:1 chat IS her soul-home;
// soulSync OFF withholds memories/mood (summary always rides — it's who they
// are to each other, not a token luxury).
import { getConversation, getPersona, listMemories } from './db';
import { buildMemorySection } from './memory';
import { buildExampleSection, parseProConfig } from './pro';
import type { Character } from './types';

export function soulContextFor(ch: Character): string {
  const convo = getConversation(ch.homeConvoId);
  if (!convo) return '';
  const parts: string[] = [];
  if (convo.summary) parts.push(`【你们的过往】${convo.summary}`);
  // 示例对话 (v2.3): community voices (moments/groups) don't run through
  // buildProSections, so the few-shot anchors ride here — each path gets
  // the section exactly once.
  const cfg = parseProConfig(getPersona(ch.personaId)?.proConfig ?? null);
  const ex = cfg ? buildExampleSection(cfg) : '';
  if (ex) parts.push(ex);
  if (ch.soulSync === 1) {
    if (convo.memoryEnabled === 1) {
      const mems = listMemories(ch.homeConvoId);
      if (mems.length) parts.push(buildMemorySection(mems));
    }
    if (convo.moodLabel) parts.push(`【你此刻的心情】${convo.moodLabel}`);
  }
  return parts.join('\n\n');
}
