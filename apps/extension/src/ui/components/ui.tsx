import { X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useState } from 'react';

/** Joins the truthy class names with spaces, so conditional Tailwind classes can be written inline. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/** A bordered section with an optional header (title, subtitle, actions). Pass `padded={false}` for edge-to-edge content such as tables. */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'p-5', padded && !!(title || actions) && 'pt-4')}>{children}</div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * The dashboard's button: `secondary` variant and `type="button"` by default (both can be
 * overridden). Use `danger` only for actions that remove data.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'bg-critical text-white hover:brightness-110',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** Semantic status colors shared by badges, callouts and job states; each maps to a color token in `styles.css`. */
export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical';

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  good: 'bg-good',
  warn: 'bg-warn',
  serious: 'bg-serious',
  critical: 'bg-critical',
};

/** Status always pairs color with a label (and optionally an icon). */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2">
      {icon ?? <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

/** A small card with one headline value, its label, an optional icon and an optional line below. */
export function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-xs font-medium text-ink-2">
        {label}
        <span className="text-muted">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

/** Meter: fill carries severity; the track is a lighter step of the same family. */
export function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const fill = ratio >= 1 ? 'bg-critical' : ratio >= 0.8 ? 'bg-warn' : 'bg-accent';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft"
      role="meter"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-500', fill)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

/** Wraps a form control in a `<label>`, with a caption above it and an optional hint below. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** An on/off switch (`role="switch"`) with a label and an optional description. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft',
          checked ? 'bg-accent' : 'bg-axis',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-2">{description}</span>}
      </span>
    </label>
  );
}

/** A row of buttons of which exactly one is selected; controlled through `value` and `onChange`. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A centered dialog over a dimmed backdrop. It renders nothing while `open` is false; Escape and
 * a click on the backdrop both call `onClose`.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-ink-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Placeholder for a list or chart with nothing to show yet, with an optional call to action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-2">{icon}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-ink-2">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** An inline notice with a colored bar on the left; the color comes from `tone` (default `warn`). */
export function Callout({
  tone = 'warn',
  icon,
  title,
  children,
}: {
  tone?: Tone;
  icon: ReactNode;
  title?: ReactNode;
  children: ReactNode;
}) {
  const bar = {
    neutral: 'bg-muted',
    accent: 'bg-accent',
    good: 'bg-good',
    warn: 'bg-warn',
    serious: 'bg-serious',
    critical: 'bg-critical',
  }[tone];
  return (
    <div className="relative flex gap-3 overflow-hidden rounded-lg border border-line bg-surface-2 py-3 pr-4 pl-5 text-xs text-ink-2">
      <span className={cx('absolute inset-y-0 left-0 w-1', bar)} />
      <span className="mt-px shrink-0 text-ink">{icon}</span>
      <div>
        {title && <p className="mb-0.5 text-sm font-medium text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** The current time in ms since the epoch, re-rendering the component every `intervalMs` ms. Drives countdowns and "5m ago" labels. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The title row at the top of each page, with an optional description and actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
