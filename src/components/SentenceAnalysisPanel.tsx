import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { Material, MaterialSentence } from '../types';
import Button from './ui/Button';
import {
    cachedSentenceAnalysis, loadSentenceAnalysis, saveSentenceAnalysis, analyzeAndSaveSentence,
    unsavedSentenceAnalysis, inflightSentenceAnalysis, setUnsavedSentenceAnalysis, AnalyzeOutcome, UnsavedResult, SentenceAnalysisError,
} from '../services/sentenceAnalysis';
import { SentenceAnalysisRecord, analysisFreshness, neighborTexts, ANALYSIS_VERSION } from '../utils/sentenceAnalysis';

// 句子全面解析（影子跟讀）：預設收合；展開才讀存檔，沒有才顯示「解析這一句」
// 規劃：docs/plans/sentence-analysis.md（擁有者 2026-11-13 核准）；修正：docs/plans/review-fixes-50-51.md

const CATEGORY_LABEL: Record<string, string> = { structural: '結構句型', phrase: '片語', collocation: '語組' };
const MAX_SENTENCE_CHARS = 1000;

type Status = 'closed' | 'loading' | 'none' | 'ready' | 'loadError';

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
    <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-bold tracking-wide text-ink">{title}</h4>
        {children}
        {note && <p className="text-xs text-muted">{note}</p>}
    </section>
);

interface Props {
    material: Material;
    sentence: MaterialSentence;
    sentenceIndex: number;
}

/** 讀取失敗的原因 → 提示（#6） */
const loadErrorText = (e: unknown) => {
    if (e instanceof SentenceAnalysisError && e.code === 'auth') return '請先登入';
    if (e instanceof SentenceAnalysisError && e.code === 'id') return '這句的資料編號異常，無法解析';
    return '讀取失敗，請檢查網路';
};

/** 只包住解析面板的錯誤防護（#12）：顯示出錯時不影響整個跟讀畫面 */
class AnalysisErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    declare readonly props: { children: React.ReactNode };
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(err: unknown) { console.error('[句子解析] 顯示失敗', err); }
    render() {
        if (this.state.failed) {
            return (
                <div role="alert" className="mt-6 max-w-[640px] rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
                    解析內容格式異常，可以重新解析（換到別句再回來）
                </div>
            );
        }
        return this.props.children;
    }
}

export default function SentenceAnalysisPanel(props: Props) {
    // 換句時重設錯誤防護
    return (
        <AnalysisErrorBoundary key={`${props.material.id}__${props.sentence.id}`}>
            <SentenceAnalysisPanelInner {...props} />
        </AnalysisErrorBoundary>
    );
}

function SentenceAnalysisPanelInner({ material, sentence, sentenceIndex }: Props) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<Status>('closed');
    const [loadError, setLoadError] = useState('');
    const [record, setRecord] = useState<SentenceAnalysisRecord | null>(() => cachedSentenceAnalysis(material.id, sentence.id));
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** AI 成功但沒存起來：結果與原因都記在服務層，重新掛載後仍正確（#5） */
    const [unsaved, setUnsaved] = useState<{ rec: SentenceAnalysisRecord; result: UnsavedResult } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    // 換句或離開後，舊請求不更新畫面（結果仍存到它自己那一句）
    const sentenceKeyRef = useRef(`${material.id}__${sentence.id}`);
    const mountedRef = useRef(true);
    // StrictMode 會先跑一次清理再重新初始化：初始化時一定要設回 true（審查第 1 輪，Codex）
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    useEffect(() => {
        const key = `${material.id}__${sentence.id}`;
        sentenceKeyRef.current = key;
        setOpen(false);
        setStatus('closed');
        setRecord(cachedSentenceAnalysis(material.id, sentence.id));
        setError(null);
        setNotice(null);
        // 錄音中面板會卸載：沒存起來的結果與進行中的請求都在服務層，重新掛載時接回來（審查第 1 輪，Codex）
        setUnsaved(unsavedSentenceAnalysis(material.id, sentence.id));
        const running = inflightSentenceAnalysis(material.id, sentence.id);
        setAnalyzing(!!running);
        if (running) running.then((o) => applyOutcome(o, key), (e) => applyFailure(e, key));
    }, [material.id, sentence.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    const isCurrent = (key: string) => mountedRef.current && sentenceKeyRef.current === key;
    const { prevText, nextText } = neighborTexts(material.sentences, sentenceIndex);
    const current = { text: sentence.text, translation: sentence.translation || '', prevText, nextText };
    const shown = unsaved?.rec ?? record;
    const freshness = shown ? analysisFreshness(shown, current, ANALYSIS_VERSION) : null;
    const tooLong = sentence.text.length > MAX_SENTENCE_CHARS;

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (next) setError(null);
        if (!next || record || status === 'loading') return;
        const key = sentenceKeyRef.current;
        setStatus('loading');
        try {
            const rec = await loadSentenceAnalysis(material.id, sentence.id);
            if (!isCurrent(key)) return;
            setRecord(rec);
            setStatus(rec ? 'ready' : 'none');
        } catch (e) {
            console.warn('[句子解析] 讀取失敗', e);
            if (isCurrent(key)) { setLoadError(loadErrorText(e)); setStatus('loadError'); }
        }
    };

    const applyOutcome = (o: AnalyzeOutcome, key: string) => {
        if (!isCurrent(key)) return;
        setAnalyzing(false);
        if (o.result === 'saved') {
            setRecord(o.rec);
            setUnsaved(null);
            setStatus('ready');
            return;
        }
        if (o.result === 'missing-material') {
            setUnsaved(null);
            setRecord(o.rec);
            setNotice('這份教材已被刪除，解析沒有存起來');
            return;
        }
        setUnsaved({ rec: o.rec, result: o.result });
    };
    const applyFailure = (e: any, key: string) => {
        if (!isCurrent(key)) return;
        setAnalyzing(false);
        // 逾時、太長、沒登入等已是完整提示，直接顯示；其他錯誤包成「解析失敗，再試一次（…）」（審查第 2 輪，Gemini）
        setError(e instanceof SentenceAnalysisError ? e.message : `解析失敗，再試一次（${e?.message || '未知錯誤'}）`);
    };

    const runAnalyze = () => {
        if (analyzing || tooLong) return;
        const key = sentenceKeyRef.current;
        setAnalyzing(true);
        setError(null);
        setNotice(null);
        setUnsaved(null);
        analyzeAndSaveSentence(material.id, sentence.id, { ...current, materialTitle: material.title || '' })
            .then((o) => applyOutcome(o, key), (e) => applyFailure(e, key));
    };

    const retrySave = async () => {
        if (!unsaved || analyzing) return;
        const key = sentenceKeyRef.current;
        const rec = unsaved.rec;
        setAnalyzing(true);
        setError(null);
        try {
            const r = await saveSentenceAnalysis(rec);
            setUnsavedSentenceAnalysis(rec, r);
            if (!isCurrent(key)) return;
            if (r === 'saved') { setRecord(rec); setUnsaved(null); setStatus('ready'); }
            else if (r === 'missing-material') { setUnsaved(null); setRecord(rec); setNotice('這份教材已被刪除，解析沒有存起來'); }
            else setUnsaved({ rec, result: r });
        } catch (e) {
            console.warn('[句子解析] 再存一次失敗', e);
            if (isCurrent(key)) setError('還是沒有存起來，請檢查網路後再試一次');
        } finally {
            if (isCurrent(key)) setAnalyzing(false);
        }
    };

    const a = shown?.analysis;

    return (
        <div className="mt-6 max-w-[640px] rounded-2xl border border-line bg-surface">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls={`analysis-${sentence.id}`}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left focus-visible:outline-2 focus-visible:outline-accent"
            >
                <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                    <Sparkles size={16} className="text-accent" aria-hidden="true" />
                    句子解析
                </span>
                <ChevronDown size={18} className={`text-muted transition-transform duration-[var(--dur-fast)] ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {open && (
                <div id={`analysis-${sentence.id}`} className="flex flex-col gap-5 border-t border-line px-4 pt-4 pb-5">
                    {status === 'loading' && !a && (
                        <p role="status" className="flex items-center gap-2 text-sm text-muted">
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />讀取中…
                        </p>
                    )}
                    {status === 'loadError' && !a && (
                        <div className="flex flex-col items-start gap-2">
                            <p className="text-sm text-danger">{loadError || '讀取失敗，請檢查網路'}</p>
                            <Button variant="secondary" size="sm" onClick={() => { setOpen(false); setStatus('closed'); }}>收起</Button>
                        </div>
                    )}

                    {!a && status === 'none' && tooLong && (
                        <p className="text-sm text-muted">這句太長，無法解析（上限 1000 字）</p>
                    )}
                    {!a && status === 'none' && !tooLong && (
                        <div className="flex flex-col items-start gap-2">
                            <Button size="md" onClick={runAnalyze} disabled={analyzing} icon={analyzing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}>
                                {analyzing ? '解析中…' : '解析這一句'}
                            </Button>
                            <p className="text-xs text-muted">第一次需要 AI 解析，約 10～40 秒；之後直接看存好的內容</p>
                        </div>
                    )}

                    {error && (
                        <div role="alert" className="flex flex-col items-start gap-2">
                            <p className="text-sm text-danger">{error}</p>
                        </div>
                    )}

                    {notice && (
                        <p role="status" className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-ink">{notice}</p>
                    )}
                    {unsaved && (
                        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-warn/10 px-3 py-2">
                            {unsaved.result === 'saveFailed' ? (
                                <>
                                    <p className="text-sm text-ink">解析好了，但沒有存起來</p>
                                    <Button variant="secondary" size="sm" onClick={retrySave} disabled={analyzing}>再存一次</Button>
                                </>
                            ) : (
                                <p className="text-sm text-ink">句子已變更或已刪除，解析沒有存起來，請重新解析</p>
                            )}
                        </div>
                    )}

                    {a && (
                        <>
                            {freshness === 'stale' && <p className="text-xs text-warn">原句或解析格式已更新，這是舊的解析，可以重新解析</p>}
                            {freshness === 'contextChanged' && <p className="text-xs text-muted">翻譯或前後句已改，可重新解析</p>}

                            <Section title="一句話看懂">
                                <p className="text-[15px] leading-relaxed text-ink">{a.overview}</p>
                            </Section>

                            {a.chunks.length > 0 && (
                                <Section title="意群" note="依文字建議的意群，實際停頓以原音為準">
                                    <p lang="en" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-reading text-[17px] leading-relaxed text-ink">
                                        {a.chunks.map((c, i) => (
                                            <React.Fragment key={i}>
                                                {i > 0 && <span className="h-4 w-0.5 rounded-full bg-accent/60" aria-hidden="true" />}
                                                <span>{c}</span>
                                            </React.Fragment>
                                        ))}
                                    </p>
                                </Section>
                            )}

                            {a.structure && (
                                <Section title="句子結構">
                                    <p className="text-sm text-ink"><span className="text-muted">主幹　</span><span lang="en" className="font-reading">{a.structure.main}</span></p>
                                    {a.structure.parts.length > 0 && (
                                        <ul className="flex flex-col gap-1.5">
                                            {a.structure.parts.map((p, i) => (
                                                <li key={i} className="text-sm text-ink"><span lang="en" className="font-reading">{p.text}</span><span className="text-muted">：{p.role}</span></li>
                                            ))}
                                        </ul>
                                    )}
                                </Section>
                            )}

                            {a.grammar.length > 0 && (
                                <Section title="文法重點">
                                    <ul className="flex flex-col gap-2">
                                        {a.grammar.map((g, i) => (
                                            <li key={i} className="text-sm leading-relaxed text-ink"><span className="font-medium">{g.point}</span><span className="text-muted">　{g.explanation}</span></li>
                                        ))}
                                    </ul>
                                </Section>
                            )}

                            {a.vocabulary.length > 0 && (
                                <Section title="重點單字">
                                    <ul className="flex flex-col gap-2">
                                        {a.vocabulary.map((v, i) => (
                                            <li key={i} className="text-sm leading-relaxed text-ink">
                                                <span lang="en" className="font-reading text-[15px] font-medium">{v.word}</span>
                                                {v.pos && <span className="text-muted">（{v.pos}）</span>}
                                                <span>　{v.meaning}</span>
                                                {v.collocation && <span className="block text-xs text-muted">常見搭配：<span lang="en">{v.collocation}</span></span>}
                                            </li>
                                        ))}
                                    </ul>
                                </Section>
                            )}

                            {a.patterns.length > 0 && (
                                <Section title="句型・片語・語組">
                                    <ul className="flex flex-col gap-3">
                                        {a.patterns.map((p, i) => (
                                            <li key={i} className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5">
                                                <p className="text-sm text-ink">
                                                    <span className="mr-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-ink">{CATEGORY_LABEL[p.category]}</span>
                                                    <span lang="en" className="font-reading text-[15px] font-medium">{p.text}</span>
                                                </p>
                                                <p className="text-sm text-ink">{p.meaningZh}</p>
                                                {p.usage && <p className="text-xs text-muted">{p.usage}</p>}
                                                {p.examples.map((e, j) => (
                                                    <p key={j} className="text-sm leading-relaxed">
                                                        <span lang="en" className="block font-reading text-ink">{e.en}</span>
                                                        <span className="block text-muted">{e.zh}</span>
                                                    </p>
                                                ))}
                                            </li>
                                        ))}
                                    </ul>
                                </Section>
                            )}

                            {a.pronunciation.length > 0 && (
                                <Section title="發音與跟讀提示" note="一般發音習慣，以原音為準">
                                    <ul className="flex list-disc flex-col gap-1.5 pl-5">
                                        {a.pronunciation.map((t, i) => <li key={i} className="text-sm leading-relaxed text-ink">{t}</li>)}
                                    </ul>
                                </Section>
                            )}

                            <div className="flex items-center gap-3 pt-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={runAnalyze}
                                    disabled={analyzing}
                                    icon={analyzing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
                                >
                                    {analyzing ? '解析中…' : '重新解析'}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
