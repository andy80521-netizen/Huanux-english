import { describe, it, expect } from 'vitest';
import { compareWords, canAccumulatePattern, calculateShadowingScores, isShadowingPass } from '../src/utils/scoring';
import { canonicalSpelling } from '../src/utils/spellingVariants';

// 規劃：docs/plans/spelling-variants.md（驗收條件 1～11）
const errs = (user: string, target: string) => compareWords(user, target).errors;

describe('英美拼字視為同一個字（驗收 1、2）', () => {
  it('英式原句、美式辨識 → 0 錯、內容 100', () => {
    const r = compareWords('My favorite color is gray', 'My favourite colour is grey');
    expect(r.errors).toBe(0);
    expect(r.contentScore).toBe(100);
  });

  it('美式原句、英式辨識 → 0 錯', () => {
    expect(errs('My favourite colour is grey', 'My favorite color is gray')).toBe(0);
    expect(errs('The centre of the theatre', 'The center of the theater')).toBe(0);
  });
});

describe('詞形變化（驗收 3）', () => {
  const pairs: [string, string][] = [
    ['realised', 'realized'], ['organisation', 'organization'], ['travelled', 'traveled'],
    ['traveller', 'traveler'], ['centres', 'centers'], ['centred', 'centered'], ['theatre', 'theater'],
    ['programme', 'program'], ['programmes', 'programs'], ['practising', 'practicing'],
    ['analysed', 'analyzed'], ['judgement', 'judgment'], ['enrolment', 'enrollment'],
    ['colourful', 'colorful'], ['neighbours', 'neighbors'], ['coloured', 'colored'],
    ['behavioural', 'behavioral'], ['favourites', 'favorites'], ['cancelling', 'canceling'],
    ['totalled', 'totaled'], ['practise', 'practice'],
  ];
  it.each(pairs)('%s ＝ %s（雙向）', (uk, us) => {
    expect(errs(`We ${us} it`, `We ${uk} it`)).toBe(0);
    expect(errs(`We ${uk} it`, `We ${us} it`)).toBe(0);
  });
});

describe('大小寫、標點、所有格（驗收 4）', () => {
  it('大小寫與標點不影響', () => {
    expect(errs('color', 'Colour,')).toBe(0);
    expect(errs('COLOUR!', 'color')).toBe(0);
  });
  it('所有格', () => {
    expect(errs("the center's door", "the centre's door")).toBe(0);
  });
});

describe('合寫與連字號（驗收 5）', () => {
  it('alright ＝ all right（雙向）', () => {
    expect(errs('It is all right', 'It is alright')).toBe(0);
    expect(errs('It is alright', 'It is all right')).toBe(0);
  });
  it('OK ＝ okay', () => {
    expect(errs('okay', 'OK')).toBe(0);
    expect(errs('OK.', 'Okay.')).toBe(0);
  });
  it('e-mail ＝ email（含 U+2011 連字號）', () => {
    expect(errs('send an email', 'send an e-mail')).toBe(0);
    expect(errs('send an e-mail', 'send an email')).toBe(0);
    expect(errs('send an e‑mail', 'send an email')).toBe(0);
  });
});

describe('不放寬：發音不同或不在表中的仍算錯（驗收 6）', () => {
  const pairs: [string, string][] = [
    ['mom', 'mum'], ['learned', 'learnt'], ['toward', 'towards'], ['collar', 'colour'],
    ['hor', 'hour'], ['rize', 'rise'], ['surprize', 'surprise'], ['nowhere', 'now here'],
    ['everyday', 'every day'], ['may be', 'maybe'], ['jewelry', 'jewellery'],
  ];
  it.each(pairs)('辨識 %s vs 原句 %s → 至少 1 錯', (user, target) => {
    expect(errs(user, target)).toBeGreaterThanOrEqual(1);
  });
});

describe('語言模型與影子跟讀（驗收 7、8、9）', () => {
  it('精準背出：英美拼字差異仍可累加', () => {
    expect(canAccumulatePattern(compareWords('I realized it', 'I realised it'))).toBe(true);
  });
  it('逐字比對顯示原句寫法', () => {
    expect(compareWords('my favorite', 'my favourite').diff).toEqual([
      { word: 'my', type: 'ok' }, { word: 'favourite', type: 'ok' },
    ]);
  });
  it('影子跟讀：內容 100 且通過', () => {
    const s = calculateShadowingScores('A gray center near the theater', 'A grey centre near the theatre', 2, 2);
    expect(s.content).toBe(100);
    expect(isShadowingPass(s)).toBe(true);
  });
});

describe('canonicalSpelling（驗收 10）', () => {
  it('英式轉成美式、美式不變', () => {
    expect(canonicalSpelling('colour')).toBe('color');
    expect(canonicalSpelling('color')).toBe('color');
    expect(canonicalSpelling('realisation')).toBe('realization');
  });
  it('冪等', () => {
    for (const w of ['colour', 'centre', 'travelled', 'programme', 'okay', 'grey']) {
      expect(canonicalSpelling(canonicalSpelling(w))).toBe(canonicalSpelling(w));
    }
  });
  it('不在表中的字原樣回傳', () => {
    for (const w of ['hour', 'rise', 'wise', 'promise', 'advise', 'tour', 'sour', 'here', 'mum']) {
      expect(canonicalSpelling(w)).toBe(w);
    }
  });
});
