import { flipCoin, GAMES, playRps, rollDice, rpsOutcome } from '../lib/games';

describe('rollDice', () => {
  it('maps rand to 1..sides', () => {
    expect(rollDice(6, () => 0).text).toContain('1 点');
    expect(rollDice(6, () => 0.999).text).toContain('6 点');
    expect(rollDice(6, () => 0.5).text).toContain('4 点');
    expect(rollDice(6, () => 0).game).toBe('dice');
  });
});

describe('rpsOutcome', () => {
  it('draws on equal moves', () => {
    expect(rpsOutcome('rock', 'rock')).toBe('draw');
  });
  it('resolves all winning combinations for the user', () => {
    expect(rpsOutcome('rock', 'scissors')).toBe('user');
    expect(rpsOutcome('paper', 'rock')).toBe('user');
    expect(rpsOutcome('scissors', 'paper')).toBe('user');
  });
  it('resolves losses', () => {
    expect(rpsOutcome('rock', 'paper')).toBe('her');
    expect(rpsOutcome('scissors', 'rock')).toBe('her');
  });
});

describe('playRps', () => {
  it('names both moves and the verdict, readable by the model', () => {
    const r = playRps('rock', () => 0.5); // her = paper (index 1) → user loses
    expect(r.text).toContain('你出✊石头');
    expect(r.text).toContain('她出✋布');
    expect(r.text).toContain('她赢了');
  });
  it('reports a draw', () => {
    expect(playRps('rock', () => 0).text).toContain('平局'); // her = rock
  });
});

describe('flipCoin', () => {
  it('is deterministic under a fixed rand', () => {
    expect(flipCoin(() => 0.2).text).toContain('正面');
    expect(flipCoin(() => 0.8).text).toContain('反面');
  });
});

describe('GAMES registry', () => {
  it('exposes instant and move games with distinct ids', () => {
    const ids = GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GAMES.find((g) => g.id === 'rps')?.kind).toBe('move');
    expect(GAMES.find((g) => g.id === 'dice')?.kind).toBe('instant');
    expect(GAMES.find((g) => g.id === 'rps')?.moves).toHaveLength(3);
  });
  it('every game plays to a non-empty result', () => {
    for (const g of GAMES) {
      const r = g.play(g.moves?.[0].key);
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.game).toBeTruthy();
    }
  });
});
