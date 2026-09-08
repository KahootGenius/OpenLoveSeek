import { getPersona, listConversations, listMessages } from './db';
import { fireTrigger } from './engine';
import { parseProConfig } from './pro';
import { autoReachDue } from './reach';

/**
 * One auto-reach attempt across all Life conversations: at most ONE eligible
 * conversation fires. Shared by the foreground minute-ticker (_layout), the
 * WorkManager background task and the keep-alive native tick (background.ts).
 * Safe in Expo Go — no notification imports here; pass `notify` when wanted.
 */
export async function runAutoReachSweep(
  now: Date,
  notify?: (title: string, body: string) => void,
): Promise<boolean> {
  for (const c of listConversations()) {
    if (c.lifeEnabled !== 1) continue;
    const persona = getPersona(c.personaId);
    const cfg = persona ? parseProConfig(persona.proConfig) : null;
    if (!autoReachDue({ cfg, messages: listMessages(c.id), now })) continue;
    console.log('[seekchat:reach] auto-reach firing for', c.title);
    let replyText = '';
    const fired = await fireTrigger(c.id, 'auto', {
      onDelta: () => {},
      onDone: (m) => {
        replyText = m.kind === 'image' ? '[照片]' : m.kind === 'sticker' ? '[表情包]' : m.content;
      },
      onError: () => {},
    });
    if (fired && replyText && notify) {
      notify(c.title, replyText.split('---')[0].trim().slice(0, 80));
    }
    return fired;
  }
  return false;
}
