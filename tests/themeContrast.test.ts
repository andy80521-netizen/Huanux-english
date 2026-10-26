import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// 直接解析實際的樣式檔與 index.html，確認設計 token 的對比、色階順序與防閃白腳本

const ROOT = resolve(__dirname, '..');
const css = readFileSync(resolve(ROOT, 'src/styles/app.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

/** 取得某個選擇器的區塊內容（只取第一個符合的區塊；區塊內不可有巢狀大括號） */
function block(selector: RegExp): string {
  const re = new RegExp(`(?:^|[\\s}])${selector.source}\\s*\\{([^{}]*)\\}`, 'm');
  const m = css.match(re);
  if (!m) throw new Error(`找不到樣式區塊：${selector}`);
  return m[1];
}

/** 從區塊中讀出 `--name: #RRGGBB;` 形式的變數 */
function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toUpperCase();
  }
  return out;
}

const lightTokens = vars(block(/:root/));
const darkTokens = vars(block(/(?::root)?\.dark/));
const themeVars = vars(block(/@theme/));

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_TOKENS = ['ink', 'muted', 'accent', 'gold', 'warn', 'danger'];
const SURFACE_TOKENS = ['ground', 'surface', 'surface-2'];
const ALL_TOKENS = [...TEXT_TOKENS, ...SURFACE_TOKENS, 'line', 'on-accent', 'accent-soft'];

describe('語意 token 完整', () => {
  it.each(ALL_TOKENS)('淺色與深色都定義了 --%s（六位數 hex）', (t) => {
    expect(lightTokens[t], `淺色缺 --${t}`).toMatch(/^#[0-9A-F]{6}$/);
    expect(darkTokens[t], `深色缺 --${t}`).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('語意 token 對比 ≥ 4.5:1（WCAG，不四捨五入）', () => {
  for (const [mode, tokens] of [['淺色', lightTokens], ['深色', darkTokens]] as const) {
    for (const text of TEXT_TOKENS) {
      for (const bg of SURFACE_TOKENS) {
        it(`${mode}：${text} 在 ${bg} 上`, () => {
          expect(contrast(tokens[text], tokens[bg])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${mode}：on-accent 在 accent 上`, () => {
      expect(contrast(tokens['on-accent'], tokens['accent'])).toBeGreaterThanOrEqual(4.5);
    });
    it(`${mode}：ink 在 accent-soft 上`, () => {
      expect(contrast(tokens['ink'], tokens['accent-soft'])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

const SCALE_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

function scale(name: string, steps: string[]): string[] {
  return steps.map((s) => {
    const v = themeVars[`color-${name}-${s}`];
    expect(v, `@theme 缺 --color-${name}-${s}`).toMatch(/^#[0-9A-F]{6}$/);
    return v;
  });
}

describe('既有 indigo／slate 色階重新對應', () => {
  it('indigo 50→950 亮度單調遞減', () => {
    const l = scale('indigo', SCALE_STEPS).map(luminance);
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
  });

  it('slate 50→950（含 850）亮度單調遞減', () => {
    const steps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '850', '900', '950'];
    const l = scale('slate', steps).map(luminance);
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
  });

  it('色階不再是舊版 Tailwind 預設的藍紫色（indigo-600 不是 #4F46E5）', () => {
    expect(themeVars['color-indigo-600']).not.toBe('#4F46E5');
  });

  it('indigo-600 就是淺色主色', () => {
    expect(themeVars['color-indigo-600']).toBe(lightTokens['accent']);
  });

  const W = '#FFFFFF';
  const c = (k: string) => themeVars[`color-${k}`];
  it.each([
    ['白字在 indigo-600（主要按鈕）', () => [W, c('indigo-600')]],
    ['白字在 indigo-700（按鈕 hover）', () => [W, c('indigo-700')]],
    ['indigo-400 在 slate-900（深色模式強調字）', () => [c('indigo-400'), c('slate-900')]],
    ['indigo-400 在 slate-950', () => [c('indigo-400'), c('slate-950')]],
    ['indigo-600 在白底', () => [c('indigo-600'), W]],
    ['indigo-600 在 slate-50', () => [c('indigo-600'), c('slate-50')]],
    ['indigo-800 在 indigo-50', () => [c('indigo-800'), c('indigo-50')]],
    ['slate-500 在白底', () => [c('slate-500'), W]],
    ['slate-500 在 slate-50', () => [c('slate-500'), c('slate-50')]],
    ['slate-400 在 slate-900（深色次要字）', () => [c('slate-400'), c('slate-900')]],
    ['slate-800 在 slate-50', () => [c('slate-800'), c('slate-50')]],
    ['slate-100 在 slate-950（深色主要字）', () => [c('slate-100'), c('slate-950')]],
  ] as Array<[string, () => string[]]>)('%s ≥ 4.5:1', (_label, pair) => {
    const [fg, bg] = pair();
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('index.html', () => {
  it('不再使用 Tailwind CDN', () => {
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).not.toMatch(/tailwind\.config\s*=/);
  });

  it('不再載入 Inter，改載 Newsreader 與 Noto Sans TC', () => {
    expect(html).not.toMatch(/family=Inter/);
    expect(html).toContain('family=Newsreader');
    expect(html).toContain('family=Noto+Sans+TC');
  });

  it('viewport 含 viewport-fit=cover（iPhone 底部安全區）', () => {
    expect(html).toMatch(/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/);
  });

  it('首屏底色與 app.css 的 ground 一致（淺色、深色）', () => {
    const light = html.match(/html\s*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})/);
    const dark = html.match(/html\.dark\s*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})/);
    expect(light?.[1].toUpperCase()).toBe(lightTokens['ground']);
    expect(dark?.[1].toUpperCase()).toBe(darkTokens['ground']);
  });

  it('不再寫死舊的 #f1f5f9 / #020617 底色', () => {
    expect(html.toLowerCase()).not.toContain('#f1f5f9');
    expect(html.toLowerCase()).not.toContain('#020617');
  });
});

/** 取出 index.html 中處理主題的行內腳本，在模擬環境執行，確認判斷與 resolveIsDark 一致 */
describe('index.html 防閃白腳本', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const themeScript = scripts.find((s) => s.includes('themeMode'));

  function run(opts: { stored?: string | null; systemDark: boolean; storageThrows?: boolean; noMatchMedia?: boolean }) {
    const classes = new Set<string>();
    const style: Record<string, string> = {};
    const storage = {
      getItem(k: string) {
        if (opts.storageThrows) throw new Error('SecurityError');
        return k === 'themeMode' ? opts.stored ?? null : null;
      },
      setItem() {},
      removeItem() {},
    };
    const matchMedia = opts.noMatchMedia
      ? undefined
      : (q: string) => ({ matches: q.includes('dark') ? opts.systemDark : false });
    const documentElement = {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        toggle: (c: string, force?: boolean) => {
          const on = force ?? !classes.has(c);
          if (on) classes.add(c);
          else classes.delete(c);
          return on;
        },
        contains: (c: string) => classes.has(c),
      },
      style,
    };
    const window: Record<string, unknown> = { matchMedia, localStorage: storage };
    const context = vm.createContext({ window, localStorage: storage, matchMedia, document: { documentElement } });
    vm.runInContext(themeScript as string, context);
    return { dark: classes.has('dark'), colorScheme: style.colorScheme };
  }

  it('存在且在任何外部腳本與樣式之前執行', () => {
    expect(themeScript).toBeTruthy();
    const scriptPos = html.indexOf(themeScript as string);
    const firstExternal = html.search(/<script[^>]+src=|<link[^>]+rel="stylesheet"/);
    expect(firstExternal === -1 || scriptPos < firstExternal).toBe(true);
  });

  it('不讀舊版 isDarkMode', () => {
    expect(themeScript).not.toContain('isDarkMode');
  });

  it.each([
    ['存深色、系統淺色 → 深色', { stored: 'dark', systemDark: false }, true],
    ['存淺色、系統深色 → 淺色', { stored: 'light', systemDark: true }, false],
    ['跟隨系統、系統深色 → 深色', { stored: 'system', systemDark: true }, true],
    ['沒存過、系統深色 → 深色', { stored: null, systemDark: true }, true],
    ['沒存過、系統淺色 → 淺色', { stored: null, systemDark: false }, false],
    ['無效值 "dark"（帶引號）、系統淺色 → 淺色', { stored: '"dark"', systemDark: false }, false],
    ['storage 拋錯、系統深色 → 深色（視為跟隨系統）', { storageThrows: true, systemDark: true }, true],
  ] as const)('%s', (_label, opts, expected) => {
    const r = run(opts);
    expect(r.dark).toBe(expected);
    expect(r.colorScheme).toBe(expected ? 'dark' : 'light');
  });

  it('沒有 matchMedia 時不拋錯，預設淺色', () => {
    expect(() => run({ stored: null, systemDark: false, noMatchMedia: true })).not.toThrow();
    expect(run({ stored: null, systemDark: false, noMatchMedia: true }).dark).toBe(false);
  });
});
