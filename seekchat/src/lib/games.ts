/**
 * 小游戏 (mini-games): RNG-driven interactions the user plays in chat. Each
 * produces a readable result line that is BOTH shown in the UI and fed to the
 * model (so she knows the outcome and can react). Pure logic here; the send +
 * her reaction live in engine.ts, the UI in chat/[id].tsx.
 *
 * Extension: add an entry to GAMES. `kind:'instant'` plays on one tap;
 * `kind:'move'` first asks the user to pick from `moves`. A future animated
 * game can carry extra fields on GameResult (e.g. `anim`) — callers ignore
 * unknown fields, so the shape is forward-compatible.
 */

export type Rand = () => number;

export interface GameResult {
  game: string; // game id
  text: string; // readable line, shown in chat AND read by the model
}

export function rollDice(sides = 6, rand: Rand = Math.random): GameResult {
  const v = 1 + Math.floor(rand() * sides);
  return { game: 'dice', text: `🎲 掷骰子：${v} 点` };
}

export type RpsMove = 'rock' | 'paper' | 'scissors';
const RPS_LABEL: Record<RpsMove, string> = {
  rock: '✊石头', paper: '✋布', scissors: '✌️剪刀',
};
const RPS_MOVES: RpsMove[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<RpsMove, RpsMove> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export type RpsOutcome = 'user' | 'her' | 'draw';
export function rpsOutcome(user: RpsMove, her: RpsMove): RpsOutcome {
  if (user === her) return 'draw';
  return BEATS[user] === her ? 'user' : 'her';
}

export function playRps(userMove: RpsMove, rand: Rand = Math.random): GameResult {
  const her = RPS_MOVES[Math.floor(rand() * RPS_MOVES.length)];
  const o = rpsOutcome(userMove, her);
  const verdict = o === 'draw' ? '平局' : o === 'user' ? '你赢了' : '她赢了';
  return {
    game: 'rps',
    text: `✊✋✌️ 石头剪刀布：你出${RPS_LABEL[userMove]}，她出${RPS_LABEL[her]}，${verdict}`,
  };
}

export function flipCoin(rand: Rand = Math.random): GameResult {
  return { game: 'coin', text: `🪙 抛硬币：${rand() < 0.5 ? '正面' : '反面'}` };
}

export interface GameDef {
  id: string;
  label: string;
  kind: 'instant' | 'move';
  moves?: { key: RpsMove; label: string }[]; // for kind:'move'
  play: (move?: RpsMove) => GameResult;
}

export const GAMES: GameDef[] = [
  { id: 'dice', label: '🎲 掷骰子', kind: 'instant', play: () => rollDice() },
  { id: 'coin', label: '🪙 抛硬币', kind: 'instant', play: () => flipCoin() },
  {
    id: 'rps',
    label: '✊ 石头剪刀布',
    kind: 'move',
    moves: [
      { key: 'rock', label: '✊' },
      { key: 'paper', label: '✋' },
      { key: 'scissors', label: '✌️' },
    ],
    play: (move) => playRps(move ?? 'rock'),
  },
];
