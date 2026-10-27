import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 刪除沒在用的舊單字庫（擁有者 2026-10-27 決定另開小 PR）

const path = (f: string) => resolve(__dirname, '..', f);
const read = (f: string) => readFileSync(path(f), 'utf8');

describe('舊單字庫與舊勳章已移除', () => {
  it('LibraryMode.tsx 已刪除', () => {
    expect(existsSync(path('src/components/LibraryMode.tsx'))).toBe(false);
  });
  it('constants.ts 不再有舊口說／聽力勳章等級', () => {
    const src = read('src/constants.ts');
    for (const name of ['BadgeLevel', 'BADGE_LEVELS', 'LISTENING_BADGE_LEVELS', 'GOD_LEVELS']) expect(src).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
  it('utils.ts 不再有只給舊單字庫用的函式', () => {
    const src = read('src/utils.ts');
    for (const name of ['getBadgeInfo', 'calculateTierProgress', 'fetchIPA']) expect(src).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});

describe('仍在使用的東西保留', () => {
  it('constants.ts 保留單字資料與型別', async () => {
    const c = await import('../src/constants');
    expect(Array.isArray(c.INITIAL_DATA)).toBe(true);
    expect(c.INITIAL_DATA.length).toBeGreaterThan(0);
    expect(c.INITIAL_COURSES).toBeDefined();
  });
  it('utils.ts 保留語音與比對函式', () => {
    const src = read('src/utils.ts');
    for (const name of ['getVoices', 'speakTextPromise', 'checkVocabContainment', 'expandContractions', 'SILENT_AUDIO']) expect(src).toMatch(new RegExp(`export const ${name}\\b`));
  });
});
