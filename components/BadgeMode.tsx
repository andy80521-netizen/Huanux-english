
import React, { useState } from 'react';
import { Info, X, Star, Medal, Award, Crown, Trophy, Wand2 } from 'lucide-react';
import { VocabItem, BADGE_LEVELS, LISTENING_BADGE_LEVELS, GOD_LEVELS, BadgeLevel } from '../constants';
import { getBadgeInfo } from '../utils';

const BadgeItem: React.FC<{ item: VocabItem, activeWall: string, levels: BadgeLevel[] }> = ({ item, activeWall, levels }) => {
    const isGodMode = activeWall === 'god';
    const score = isGodMode ? 100000 : (activeWall === 'speaking' ? item.mastery : item.listeningMastery);
    const { currentBadge } = getBadgeInfo(score, levels);
    const [showDetail, setShowDetail] = useState(false);

    return (
        <>
            <div onClick={() => setShowDetail(true)} className={`relative aspect-square rounded-2xl border-2 ${currentBadge.border} bg-white dark:bg-slate-900 flex flex-col items-center justify-center ${currentBadge.shadow} cursor-pointer hover:-translate-y-1 transition-all duration-300 overflow-hidden group shadow-lg`}>
                <div className={`absolute inset-0 opacity-20 bg-gradient-to-br ${currentBadge.gradient}`} />
                <div className={`relative z-10 mb-1 p-2 rounded-full ${currentBadge.bg} ${currentBadge.ring} ring-1 shadow-md transition-all duration-500 group-hover:scale-110`}>
                    <currentBadge.icon 
                        size={18} 
                        className={`${currentBadge.color} ${currentBadge.glow}`} 
                        strokeWidth={2} 
                    />
                </div>
                <div className="relative z-10 text-center w-full px-1">
                    <p className="text-[8px] font-black text-slate-700 dark:text-slate-300 truncate w-full leading-none tracking-tight">{item.id}. {item.question}</p>
                </div>
                <div className={`absolute bottom-0 w-full h-1 ${currentBadge.barColor}`} />
            </div>
            {showDetail && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowDetail(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 w-full max-w-xs shadow-2xl border-[6px] border-white dark:border-slate-800 relative animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center -mt-20 mb-6">
                            <div className={`p-6 rounded-full ${currentBadge.bg} ${currentBadge.ring} ring-[10px] ring-white dark:ring-slate-900 shadow-2xl mb-4 relative group`}>
                                <div className={`absolute inset-0 ${currentBadge.bg} opacity-30 blur-2xl rounded-full scale-150`}></div>
                                <currentBadge.icon size={64} className={`${currentBadge.color} ${currentBadge.glow} relative z-10`} strokeWidth={1.5} />
                            </div>
                            <h3 className={`text-2xl font-black ${currentBadge.color} tracking-tighter`}>{currentBadge.name}</h3>
                            <div className="flex items-center gap-2 mt-2">
                                <Star size={12} className="fill-amber-400 text-amber-400 animate-pulse" />
                                <span className="text-sm font-black text-slate-400 dark:text-slate-500 font-mono tracking-widest">{isGodMode ? 'LEGENDARY' : `${score} XP`}</span>
                                <Star size={12} className="fill-amber-400 text-amber-400 animate-pulse" />
                            </div>
                        </div>
                        <div className="text-center space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-inner"><p className="text-[9px] font-black text-slate-300 dark:text-slate-500 uppercase tracking-widest mb-1">Question</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-relaxed">{item.question}</p></div>
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 shadow-sm"><p className="text-[9px] font-black text-indigo-300 dark:text-indigo-400 uppercase tracking-widest mb-1">Answer</p><p className="text-lg font-black text-indigo-600 dark:text-indigo-400 leading-tight">{item.answer}</p></div>
                        </div>
                        <button onClick={() => setShowDetail(false)} className="mt-8 w-full py-4 bg-slate-900 dark:bg-slate-700 text-white font-black rounded-2xl shadow-xl transition-all active:scale-90">收下榮耀</button>
                    </div>
                </div>
            )}
        </>
    );
};

const LevelCard: React.FC<{ level: BadgeLevel, index: number }> = ({ level, index }) => (
    <div className={`flex items-center gap-5 p-5 rounded-[1.5rem] border-2 ${level.border} bg-white dark:bg-slate-900 relative overflow-hidden group shadow-md hover:shadow-lg transition-all duration-300`}>
        <div className={`absolute inset-0 bg-gradient-to-r ${level.gradient} opacity-10 transition-opacity duration-500`} />
        <div className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${level.bg} ${level.color} ring-4 ${level.ring} shrink-0`}>
            <level.icon size={24} strokeWidth={2} className={level.glow} />
        </div>
        <div className="relative z-10 flex-1">
            <h4 className={`font-black text-base ${level.color} tracking-tighter`}>{level.name}</h4>
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">門檻: {level.threshold} XP</p>
        </div>
        <div className="relative z-10">
            <div className={`w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400 dark:text-slate-500 border border-slate-100 dark:border-slate-700 shadow-inner`}>
                {index === 99 ? 'MAX' : `LV${index}`}
            </div>
        </div>
    </div>
);

const BadgeMode: React.FC<{ vocabData: VocabItem[] }> = ({ vocabData }) => {
    const [activeWall, setActiveWall] = useState('speaking');
    const [showGallery, setShowGallery] = useState(false);

    // 語神權杖邏輯：同時達到大師 (10000) 與 天聽神 (5000)
    const godItems = vocabData.filter(q => (q.mastery || 0) >= 10000 && (q.listeningMastery || 0) >= 5000 && !q.isHidden);
    const godItemIds = new Set(godItems.map(item => item.id));

    // 過濾出尚未晉升語神的成就，避免重複出現在普通牆面
    const speakingBadges = vocabData.filter(q => (q.mastery || 0) >= 1000 && !q.isHidden && !godItemIds.has(q.id)).sort((a, b) => b.mastery - a.mastery);
    const listeningBadges = vocabData.filter(q => (q.listeningMastery || 0) >= 500 && !q.isHidden && !godItemIds.has(q.id)).sort((a, b) => b.listeningMastery - a.listeningMastery);

    let currentBadges, levels, wallTheme, countLabel, WallIcon;
    if (activeWall === 'god') { 
        currentBadges = godItems; 
        levels = GOD_LEVELS; 
        wallTheme = { color: 'text-yellow-500', bg: 'bg-yellow-50' }; 
        countLabel = '傳 奇 權 杖'; 
        WallIcon = Wand2; 
    } else if (activeWall === 'listening') { 
        currentBadges = listeningBadges; 
        levels = LISTENING_BADGE_LEVELS; 
        wallTheme = { color: 'text-sky-600', bg: 'bg-sky-50' }; 
        countLabel = '獲 得 獎 盃'; 
        WallIcon = Trophy; 
    } else { 
        currentBadges = speakingBadges; 
        levels = BADGE_LEVELS; 
        wallTheme = { color: 'text-rose-600', bg: 'bg-rose-50' }; 
        countLabel = '獲 得 勳 章'; 
        WallIcon = Medal; 
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-5 overflow-y-auto relative no-scrollbar">
            <div className="flex justify-between items-center mb-5 px-1">
                <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tighter">成就聖殿</h2>
                <button 
                    onClick={() => setShowGallery(true)}
                    className="p-3 bg-white dark:bg-slate-900 rounded-2xl shadow-md border border-slate-100 dark:border-slate-800 text-indigo-600 dark:text-indigo-400 hover:scale-110 active:scale-95 transition-all"
                >
                    <Info size={22} />
                </button>
            </div>

            {/* 導覽切換列 - 放大尺寸 */}
            <div className="bg-white dark:bg-slate-900 p-1.5 rounded-[1.5rem] border border-slate-200 dark:border-slate-800 mb-8 shadow-sm flex items-center justify-between gap-1.5">
                <button 
                    onClick={() => setActiveWall('speaking')} 
                    className={`flex-1 py-4 px-2 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-300 ${activeWall === 'speaking' ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                    <Medal size={20} /> 王者聲座
                </button>
                <button 
                    onClick={() => setActiveWall('listening')} 
                    className={`flex-1 py-4 px-2 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-300 ${activeWall === 'listening' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                    <Trophy size={20} /> 神的耳語
                </button>
                <button 
                    onClick={() => setActiveWall('god')} 
                    className={`flex-1 py-4 px-2 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-300 ${activeWall === 'god' ? 'bg-yellow-500 text-white shadow-lg' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                    <Wand2 size={20} /> 登峰語神
                </button>
            </div>

            {/* 統計卡面 - 扁長型橫向樣式 */}
            <div className="bg-white dark:bg-slate-900 px-10 py-8 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 mb-10 flex items-center justify-between relative overflow-hidden group min-h-[140px]">
                <div className={`absolute -right-6 -bottom-6 opacity-[0.08] ${wallTheme.color} rotate-12 transition-transform duration-1000 group-hover:scale-110`}>
                    <WallIcon size={180} />
                </div>
                
                <div className="relative z-10 text-left">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-[0.5em] mb-2">
                        {countLabel}
                    </p>
                    <div className="flex items-baseline gap-3">
                        <span className={`text-7xl font-black ${wallTheme.color} leading-none tracking-tighter drop-shadow-sm`}>
                            {currentBadges.length}
                        </span>
                        <span className="text-xl font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest">Total</span>
                    </div>
                </div>

                <div className={`relative z-10 w-20 h-20 rounded-[2rem] bg-slate-50 dark:bg-slate-800 flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 ${wallTheme.color} shadow-inner transition-transform group-hover:rotate-12 duration-500`}>
                    <WallIcon size={40} strokeWidth={2.5} />
                </div>
            </div>

            {/* 勳章網格 */}
            <div className="grid grid-cols-6 gap-3 pb-32 px-1">
                {currentBadges.map(item => (<BadgeItem key={item.id} item={item} activeWall={activeWall} levels={levels} />))}
                {currentBadges.length === 0 && (
                    <div className="col-span-6 py-20 text-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[3rem] bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
                        <Trophy className="mx-auto mb-6 opacity-10" size={64} />
                        <h4 className="font-black text-slate-500 dark:text-slate-400 text-lg mb-2">榮耀之路尚未開啟</h4>
                        <p className="text-[10px] uppercase tracking-widest font-black opacity-40 px-12 leading-relaxed">
                            {activeWall === 'god' ? '需同時達成口說 10000 且 聽力 5000 積分' : `持續練習以獲得成就勳章`}
                        </p>
                    </div>
                )}
            </div>

            {/* 成就圖鑑彈窗 */}
            {showGallery && (
                <div className="fixed inset-0 z-[110] bg-slate-950/98 backdrop-blur-3xl p-6 flex flex-col overflow-y-auto animate-in fade-in duration-500" onClick={() => setShowGallery(false)}>
                    <div className="max-w-md mx-auto w-full py-8" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-16">
                            <div>
                                <h3 className="text-white text-4xl font-black tracking-tighter">成就聖典</h3>
                                <p className="text-indigo-400 text-xs font-black uppercase tracking-[0.5em] mt-3">The Gilded Chronicle</p>
                            </div>
                            <button onClick={() => setShowGallery(false)} className="p-4 bg-white/5 text-white rounded-2xl border border-white/10 shadow-2xl"><X size={24} /></button>
                        </div>

                        <div className="space-y-16">
                            <section>
                                <h4 className="text-rose-500 text-[11px] font-black uppercase tracking-[0.5em] mb-8 flex items-center gap-4">
                                    <div className="w-10 h-px bg-rose-500/30"></div> 王者聲座體系 <div className="flex-1 h-px bg-rose-500/30"></div>
                                </h4>
                                <div className="space-y-5">
                                    {BADGE_LEVELS.map((lvl, i) => (
                                        <LevelCard key={lvl.name} level={lvl} index={i} />
                                    ))}
                                </div>
                            </section>

                            <section>
                                <h4 className="text-sky-500 text-[11px] font-black uppercase tracking-[0.5em] mb-8 flex items-center gap-4">
                                    <div className="w-10 h-px bg-sky-500/30"></div> 神的耳語體系 <div className="flex-1 h-px bg-sky-500/30"></div>
                                </h4>
                                <div className="space-y-5">
                                    {LISTENING_BADGE_LEVELS.map((lvl, i) => (
                                        <LevelCard key={lvl.name} level={lvl} index={i} />
                                    ))}
                                </div>
                            </section>

                            <section className="pb-24">
                                <h4 className="text-yellow-500 text-[11px] font-black uppercase tracking-[0.5em] mb-8 flex items-center gap-4">
                                    <div className="w-10 h-px bg-yellow-500/30"></div> 終極語言之巔 <div className="flex-1 h-px bg-yellow-500/30"></div>
                                </h4>
                                <div className="space-y-5">
                                    <LevelCard level={GOD_LEVELS[0]} index={99} />
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BadgeMode;
