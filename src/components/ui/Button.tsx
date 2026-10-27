import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium tracking-wide select-none ' +
  'transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-out-soft)] ' +
  'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 dark:hover:brightness-105',
  secondary: 'bg-transparent text-ink border border-line hover:bg-surface-2',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-10 px-4 text-[13px] rounded-full',
  md: 'min-h-11 px-5 text-[15px] rounded-full',
  lg: 'min-h-14 px-8 text-[17px] rounded-full',
};

/** 共用按鈕：md／lg 最小點擊區 44px（sm 為 40px，只用於次要的精簡按鈕）；預設 type="button"，避免放進表單時誤送出 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, fullWidth, className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export default Button;
