// The dashboard's small component kit on Fluent UI (ADR-0019): the same props as before the move, so pages keep
// their shape, with Fluent's components, tokens and status colors underneath.
import {
  Badge as FluentBadge,
  Body1,
  Button as FluentButton,
  type ButtonProps as FluentButtonProps,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Switch,
  Title3,
  ToggleButton,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronUp16Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react';

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow2,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL} 0`,
  },
  cardTitle: {
    margin: 0,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  cardSubtitle: { margin: `${tokens.spacingVerticalXXS} 0 0`, color: tokens.colorNeutralForeground2 },
  row: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: tokens.spacingHorizontalS },
  minW0: { minWidth: 0 },
  padded: { padding: tokens.spacingHorizontalXL },
  paddedBelowHeader: { paddingTop: tokens.spacingVerticalL },
  danger: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': { backgroundColor: tokens.colorStatusDangerForeground1, color: tokens.colorNeutralForegroundOnBrand },
    ':hover:active': { backgroundColor: tokens.colorStatusDangerForeground1 },
  },
  stat: {
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  statLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  statIcon: { color: tokens.colorNeutralForeground3, display: 'inline-flex' },
  statValue: {
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeHero700,
    lineHeight: tokens.lineHeightHero700,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums',
  },
  statSub: {
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  meter: {
    height: '6px',
    width: '100%',
    overflow: 'hidden',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
  },
  meterFill: {
    height: '100%',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground,
    transitionProperty: 'width',
    transitionDuration: tokens.durationSlow,
  },
  meterWarn: { backgroundColor: tokens.colorStatusWarningForeground1 },
  meterCritical: { backgroundColor: tokens.colorStatusDangerForeground1 },
  field: { display: 'block' },
  fieldLabel: {
    display: 'block',
    marginBottom: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  fieldHint: {
    display: 'block',
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  toggle: { display: 'flex', flexDirection: 'column' },
  toggleDescription: { marginTop: `calc(-1 * ${tokens.spacingVerticalXS})`, paddingLeft: '48px' },
  segmented: {
    display: 'inline-flex',
    gap: tokens.spacingHorizontalXXS,
    padding: tokens.spacingHorizontalXXS,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  segment: { minWidth: 'auto' },
  disclosure: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', rowGap: tokens.spacingVerticalXS },
  disclosureButton: { paddingLeft: 0, minWidth: 'auto', fontWeight: tokens.fontWeightSemibold },
  disclosureSummary: { color: tokens.colorNeutralForeground3 },
  disclosureBody: { alignSelf: 'stretch' },
  dialogText: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  dialogBody: { position: 'relative' },
  dialogActions: { whiteSpace: 'nowrap' },
  dialogTitle: { paddingRight: '40px' },
  dialogClose: { position: 'absolute', top: `calc(-1 * ${tokens.spacingVerticalXS})`, right: 0 },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXXL}`,
  },
  emptyIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    marginBottom: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
  },
  emptyTitle: { margin: 0, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  emptyBody: { margin: `${tokens.spacingVerticalXS} 0 0`, maxWidth: '24rem', color: tokens.colorNeutralForeground2 },
  emptyAction: { marginTop: tokens.spacingVerticalL },
  callout: {
    position: 'relative',
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    overflow: 'hidden',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  calloutBar: { position: 'absolute', insetBlock: 0, left: 0, width: '4px' },
  calloutIcon: { flexShrink: 0, marginTop: '1px', color: tokens.colorNeutralForeground1, display: 'inline-flex' },
  calloutTitle: {
    margin: `0 0 ${tokens.spacingVerticalXXS}`,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  pageHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalXXL,
  },
  pageTitle: { margin: 0, color: tokens.colorNeutralForeground1 },
  pageDescription: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    maxWidth: '42rem',
    color: tokens.colorNeutralForeground2,
  },
});

/** The color behind each tone, for dots, bars and meters. */
const useToneStyles = makeStyles({
  neutral: { backgroundColor: tokens.colorNeutralForeground3 },
  accent: { backgroundColor: tokens.colorBrandBackground },
  good: { backgroundColor: tokens.colorStatusSuccessForeground1 },
  warn: { backgroundColor: tokens.colorStatusWarningForeground1 },
  serious: { backgroundColor: tokens.colorPaletteDarkOrangeForeground1 },
  critical: { backgroundColor: tokens.colorStatusDangerForeground1 },
});

/**
 * A bordered section with an optional header (title, subtitle, actions). Pass `padded={false}` for edge-to-edge
 * content such as tables. The content says how it is padded in `data-padded`: `full`, `below-header` or `none`.
 */
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
  const styles = useStyles();
  const header = !!(title || actions);
  return (
    <section className={mergeClasses(styles.card, className)}>
      {header && (
        <header className={styles.cardHeader}>
          <div className={styles.minW0}>
            {title && <h2 className={styles.cardTitle}>{title}</h2>}
            {subtitle && (
              <Caption1 as="p" block className={styles.cardSubtitle}>
                {subtitle}
              </Caption1>
            )}
          </div>
          {actions && <div className={styles.row}>{actions}</div>}
        </header>
      )}
      <div
        className={mergeClasses(padded && styles.padded, padded && header && styles.paddedBelowHeader)}
        data-padded={!padded ? 'none' : header ? 'below-header' : 'full'}
      >
        {children}
      </div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const APPEARANCE = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'subtle',
  danger: 'primary',
} as const satisfies Record<ButtonVariant, FluentButtonProps['appearance']>;

/**
 * The dashboard's button, a Fluent `Button`: `secondary` and `type="button"` by default (both can be
 * overridden); `ghost` is Fluent's subtle appearance. Use `danger` only for actions that remove data; disabled, it
 * looks like any disabled button. The variant and size are in `data-variant` and `data-size`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  iconPosition = 'before',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  /** Where the icon sits: before the label (default) or after it, as for a "Next" chevron. */
  iconPosition?: 'before' | 'after';
}) {
  const styles = useStyles();
  return (
    <FluentButton
      {...rest}
      type={type}
      appearance={APPEARANCE[variant]}
      size={size === 'sm' ? 'small' : 'medium'}
      icon={icon ? <>{icon}</> : undefined}
      iconPosition={iconPosition}
      // A disabled danger button keeps Fluent's disabled look, so it never looks clickable.
      className={mergeClasses(variant === 'danger' && !rest.disabled && styles.danger, className)}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </FluentButton>
  );
}

/** Semantic status colors shared by badges, callouts and job states, each on a Fluent status token. */
export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical';

/** Fluent's badge color for each tone. */
export const BADGE_COLOR = {
  neutral: 'informative',
  accent: 'brand',
  good: 'success',
  warn: 'warning',
  serious: 'severe',
  critical: 'danger',
} as const satisfies Record<Tone, string>;

/** A status badge: color always paired with a label, and an optional icon. The tone is in `data-tone`. */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <FluentBadge appearance="tint" color={BADGE_COLOR[tone]} icon={icon ? <>{icon}</> : undefined} data-tone={tone}>
      {children}
    </FluentBadge>
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
  const styles = useStyles();
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>
        {label}
        <span className={styles.statIcon}>{icon}</span>
      </div>
      <div className={styles.statValue}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

/**
 * A slim meter: the fill carries severity (`accent`, `warn` from 80%, `critical` when full, in `data-tone`) and never
 * passes 100%; the track is a lighter step of the brand color.
 */
export function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const styles = useStyles();
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const tone = ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'warn' : 'accent';
  return (
    <div className={styles.meter} role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <div
        className={mergeClasses(
          styles.meterFill,
          tone === 'warn' && styles.meterWarn,
          tone === 'critical' && styles.meterCritical,
        )}
        style={{ width: `${String(ratio * 100)}%` }}
        data-tone={tone}
      />
    </div>
  );
}

/** Wraps a form control in a `<label>`, with a caption above it and an optional hint below. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const styles = useStyles();
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

/**
 * An on/off switch (Fluent `Switch`, `role="switch"`) with a label and an optional description, which is the
 * switch's accessible description (`aria-describedby`).
 */
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
  const styles = useStyles();
  const descriptionId = useId();
  return (
    <div className={styles.toggle}>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        label={<>{label}</>}
        onChange={(_, data) => onChange(data.checked)}
      />
      {description && (
        <Caption1 id={descriptionId} className={styles.toggleDescription}>
          {description}
        </Caption1>
      )}
    </div>
  );
}

/**
 * A part of a page that opens on demand (#198): a quiet button with a chevron (`aria-expanded`, `aria-controls`) and,
 * while closed, an optional one-line summary of what is inside. The content is rendered only while open, so what
 * most people never change stays out of their way and out of the page's tab order.
 */
export function Disclosure({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={styles.disclosure}>
      <FluentButton
        appearance="transparent"
        size="small"
        icon={open ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
        aria-expanded={open}
        aria-controls={bodyId}
        className={styles.disclosureButton}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </FluentButton>
      {!open && summary && <Caption1 className={styles.disclosureSummary}>{summary}</Caption1>}
      <div id={bodyId} className={styles.disclosureBody}>
        {open && children}
      </div>
    </div>
  );
}

/** A row of toggle buttons of which exactly one is pressed (`aria-pressed`); controlled through `value` and `onChange`. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  const styles = useStyles();
  return (
    <div className={styles.segmented}>
      {options.map((o) => (
        <ToggleButton
          key={o.value}
          size="small"
          appearance={value === o.value ? 'secondary' : 'subtle'}
          checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={styles.segment}
        >
          {o.label}
        </ToggleButton>
      ))}
    </div>
  );
}

/**
 * A modal Fluent `Dialog` with a title, content, an optional footer and a Close button in the top corner. It renders
 * nothing while `open` is false; Escape, the Close button and a click on the backdrop all call `onClose`. The Close
 * button comes last in the page order, so Fluent focuses the dialog's first field or action when it opens; an element
 * marked `data-autofocus` takes the focus instead, once Fluent has placed it.
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
  const styles = useStyles();
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // After Fluent's own first-focus step, which runs in the dialog's effects.
    const timer = setTimeout(() => surface.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    return () => clearTimeout(timer);
  }, [open]);
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface ref={surface}>
        <DialogBody className={styles.dialogBody}>
          <DialogTitle className={styles.dialogTitle}>{title}</DialogTitle>
          <DialogContent className={styles.dialogText}>{children}</DialogContent>
          {footer && <DialogActions className={styles.dialogActions}>{footer}</DialogActions>}
          <FluentButton
            appearance="subtle"
            aria-label="Close"
            icon={<Dismiss20Regular />}
            onClick={onClose}
            className={styles.dialogClose}
          />
        </DialogBody>
      </DialogSurface>
    </Dialog>
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
  const styles = useStyles();
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{icon}</div>
      <Body1 as="p" block align="center" className={styles.emptyTitle}>
        {title}
      </Body1>
      <Caption1 as="p" block align="center" className={styles.emptyBody}>
        {body}
      </Caption1>
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/** An inline notice with a colored bar on the left; the color comes from `tone` (default `warn`, in `data-tone`). */
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
  const styles = useStyles();
  const toneStyles = useToneStyles();
  return (
    <div className={styles.callout} data-tone={tone}>
      <span className={mergeClasses(styles.calloutBar, toneStyles[tone])} />
      <span className={styles.calloutIcon}>{icon}</span>
      <div>
        {title && <p className={styles.calloutTitle}>{title}</p>}
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
  const styles = useStyles();
  return (
    <div className={styles.pageHeader}>
      <div>
        <Title3 as="h1" block className={styles.pageTitle}>
          {title}
        </Title3>
        {description && (
          <Body1 as="p" block className={styles.pageDescription}>
            {description}
          </Body1>
        )}
      </div>
      {actions && <div className={styles.row}>{actions}</div>}
    </div>
  );
}
