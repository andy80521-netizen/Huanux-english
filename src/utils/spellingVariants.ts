// 英美拼字對照：比對時把英式拼法換成美式，讓「念起來一樣、只差拼法」的字算同一個字
// 規劃：docs/plans/spelling-variants.md
//
// 規則（新增字之前請先確認）：
// - 只收英美**發音相同**的拼法（learnt／learned、mum／mom、jewellery／jewelry 發音不同，不收）
// - 全部明確列出，不用通用字尾規則（-our、-ise 規則會誤改 hour、rise、wise、promise）
// - canonicalSpelling 只做一對一轉換；合寫字（alright）放在 COMPOUND_SPLITS，由 scoring.ts 拆字

const pairs: [string, string][] = [];
const add = (uk: string, us: string) => pairs.push([uk, us]);
const addEach = (uks: string[], uss: string[]) => uks.forEach((uk, i) => add(uk, uss[i]));

// -our／-or
const OUR_STEMS = ['col', 'fav', 'flav', 'hon', 'hum', 'lab', 'neighb', 'behavi', 'harb', 'rum', 'vap',
    'endeav', 'sav', 'tum', 'od', 'arm', 'vig', 'rig', 'parl', 'cand', 'val', 'splend'];
const OUR_SUFFIXES = ['', 's', 'ed', 'ing', 'ful', 'fully', 'less', 'able', 'ably', 'ite', 'ites', 'hood', 'hoods',
    'al', 'ally', 'er', 'ers', 'y', 'ism'];
for (const stem of OUR_STEMS) {
    for (const suf of OUR_SUFFIXES) add(`${stem}our${suf}`, `${stem}or${suf}`);
}

// -ise／-ize（明確動詞清單，去掉字尾 ise）
const ISE_STEMS = ['real', 'organ', 'recogn', 'apolog', 'critic', 'emphas', 'memor', 'summar', 'priorit',
    'special', 'minim', 'maxim', 'final', 'categor', 'custom', 'familiar', 'normal', 'optim', 'personal',
    'social', 'standard', 'sympath', 'util', 'visual', 'author', 'modern', 'character', 'civil', 'global',
    'hospital', 'immun', 'legal', 'mobil', 'stabil', 'symbol', 'fertil', 'harmon', 'jeopard', 'patron',
    'colon', 'scrutin', 'energ', 'agon'];
const ISE_SUFFIXES = ['ise', 'ises', 'ised', 'ising', 'iser', 'isers', 'isation', 'isations', 'isable'];
for (const stem of ISE_STEMS) {
    for (const suf of ISE_SUFFIXES) add(stem + suf, stem + suf.replace('is', 'iz'));
}

// -yse／-yze
for (const stem of ['anal', 'paral', 'catal']) {
    for (const suf of ['yse', 'ysed', 'ysing']) add(stem + suf, stem + suf.replace('ys', 'yz'));
}
// 不收 analyses／analyzes：analyses 也是 analysis 的複數，發音不同

// -re／-er
const RE_STEMS = ['cent', 'theat', 'met', 'lit', 'fib', 'kilomet', 'centimet', 'millimet', 'calib', 'somb',
    'lust', 'spect', 'meag'];
for (const stem of RE_STEMS) {
    addEach([`${stem}re`, `${stem}res`, `${stem}red`, `${stem}ring`], [`${stem}er`, `${stem}ers`, `${stem}ered`, `${stem}ering`]);
}

// 雙 l／單 l
const LL_STEMS = ['travel', 'cancel', 'label', 'model', 'fuel', 'signal', 'level', 'channel', 'marvel',
    'quarrel', 'counsel', 'total', 'dial', 'duel'];
for (const stem of LL_STEMS) {
    for (const suf of ['led', 'ling', 'ler', 'lers', 'lor', 'lors']) add(stem + suf, stem + suf.slice(1));
}

// 個別字
addEach(['grey', 'greys', 'greyed', 'greyish', 'greying'], ['gray', 'grays', 'grayed', 'grayish', 'graying']);
addEach(['programme', 'programmes', 'programing', 'programed'], ['program', 'programs', 'programming', 'programmed']);
addEach(['cheque', 'cheques', 'tyre', 'tyres'], ['check', 'checks', 'tire', 'tires']);
addEach(['defence', 'defences', 'offence', 'offences', 'licence', 'licences', 'pretence'],
    ['defense', 'defenses', 'offense', 'offenses', 'license', 'licenses', 'pretense']);
addEach(['practise', 'practises', 'practised', 'practising'], ['practice', 'practices', 'practiced', 'practicing']);
addEach(['catalogue', 'catalogues', 'dialogue', 'dialogues', 'analogue'], ['catalog', 'catalogs', 'dialog', 'dialogs', 'analog']);
addEach(['enrol', 'enrols', 'enrolment', 'enrolments', 'fulfil', 'fulfils', 'fulfilment', 'fulfilments'],
    ['enroll', 'enrolls', 'enrollment', 'enrollments', 'fulfill', 'fulfills', 'fulfillment', 'fulfillments']);
addEach(['skilful', 'skilfully', 'wilful', 'wilfully'], ['skillful', 'skillfully', 'willful', 'willfully']);
addEach(['judgement', 'judgements', 'ageing'], ['judgment', 'judgments', 'aging']);
addEach(['plough', 'ploughs', 'ploughed', 'ploughing'], ['plow', 'plows', 'plowed', 'plowing']);
addEach(['mould', 'moulds', 'mouldy', 'moulded'], ['mold', 'molds', 'moldy', 'molded']);
addEach(['doughnut', 'doughnuts', 'storey', 'storeys', 'kerb', 'kerbs'], ['donut', 'donuts', 'story', 'stories', 'curb', 'curbs']);
addEach(['sceptic', 'sceptics', 'sceptical', 'scepticism'], ['skeptic', 'skeptics', 'skeptical', 'skepticism']);
addEach(['manoeuvre', 'manoeuvres', 'manoeuvred', 'manoeuvring'], ['maneuver', 'maneuvers', 'maneuvered', 'maneuvering']);
addEach(['cosy', 'cosier', 'cosiest', 'moustache', 'moustaches'], ['cozy', 'cozier', 'coziest', 'mustache', 'mustaches']);
addEach(['draught', 'draughts', 'gramme', 'grammes', 'gaol', 'gaols'], ['draft', 'drafts', 'gram', 'grams', 'jail', 'jails']);
add('okay', 'ok');

const CANONICAL = new Map<string, string>(pairs);

// 一個小寫字 → 比對用的標準寫法（美式）；不在表中原樣回傳
export const canonicalSpelling = (word: string): string => CANONICAL.get(word) ?? word;

// 合寫字：比對時拆成多個字（原句與辨識結果兩邊都拆）
export const COMPOUND_SPLITS = new Map<string, string[]>([
    ['alright', ['all', 'right']],
]);
