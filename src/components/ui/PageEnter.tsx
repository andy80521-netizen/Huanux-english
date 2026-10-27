import React, { useState } from 'react';

/**
 * 換畫面時的淡入＋上浮（UI 改版 ⑤）。呼叫端用 key 區分畫面，key 一變就重新掛載、重播 animate-page-in。
 * 動畫結束值是 transform: none；減少動態時由 app.css 的全域規則直接顯示。
 * animate 只在掛載當下讀取：分頁內的畫面第一次出現時傳 false，避免和外層分頁轉場疊加成兩次。
 */
const PageEnter: React.FC<{ children: React.ReactNode; className?: string; animate?: boolean }> = ({ children, className = '', animate = true }) => {
  const [play] = useState(animate);
  return <div className={`h-full min-h-0 ${play ? 'animate-page-in' : ''} ${className}`}>{children}</div>;
};

export default PageEnter;
