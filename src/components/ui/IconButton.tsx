import React from 'react';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** 只有圖示的按鈕必須提供說明文字給螢幕閱讀器 */
  'aria-label': string;
  children: React.ReactNode;
}

/** 只有圖示的圓形按鈕，點擊區 44×44 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={
        'inline-flex items-center justify-center size-11 shrink-0 rounded-full text-ink ' +
        'transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line ' +
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
        className
      }
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
