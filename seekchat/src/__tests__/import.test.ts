import { validateBackup } from '../lib/importcheck';

const ok = {
  schemaVersion: 4, personas: [], conversations: [], messages: [],
  memories: [], stickers: [], prefs: [],
};

describe('validateBackup', () => {
  it('accepts versions 1..4 with required arrays', () => {
    expect(validateBackup(JSON.stringify(ok)).ok).toBe(true);
    expect(validateBackup(JSON.stringify({ ...ok, schemaVersion: 1 })).ok).toBe(true);
  });

  it('rejects garbage, missing arrays, and future versions', () => {
    expect(validateBackup('not json').ok).toBe(false);
    expect(validateBackup(JSON.stringify({ schemaVersion: 4 })).ok).toBe(false);
    expect(validateBackup(JSON.stringify({ ...ok, schemaVersion: 99 })).ok).toBe(false);
  });

  it('reports counts for the confirm dialog (incl. optional new tables)', () => {
    const r = validateBackup(
      JSON.stringify({ ...ok, messages: [{ id: 'x' }], posts: [{ id: 'p' }] }),
    );
    expect(r.ok && r.counts.messages).toBe(1);
    expect(r.ok && r.counts.posts).toBe(1);
  });
});

describe('validateBackup — review hardening', () => {
  it('accepts v1-era backups without memories/stickers', () => {
    const v1 = { schemaVersion: 1, personas: [], conversations: [], messages: [], prefs: [] };
    expect(validateBackup(JSON.stringify(v1)).ok).toBe(true);
  });

  it('rejects non-object rows before they can throw mid-transaction', () => {
    const bad = { ...ok, personas: [null] };
    expect(validateBackup(JSON.stringify(bad)).ok).toBe(false);
    const bad2 = { ...ok, posts: [1, 2] };
    expect(validateBackup(JSON.stringify(bad2)).ok).toBe(false);
  });
});
