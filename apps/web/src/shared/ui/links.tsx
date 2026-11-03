'use client';
// Links that look like Fluent buttons and Fluent links (ADR-0019). Fluent's own Button and Link render a plain <a>,
// which would skip Next.js's client-side navigation and prefetching; these keep next/link for the site's own pages
// and use a plain <a> for everything else.
import { makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import NextLink from 'next/link';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingHorizontalSNudge,
    boxSizing: 'border-box',
    minHeight: '32px',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    border: `${tokens.strokeWidthThin} solid transparent`,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase300,
    textDecorationLine: 'none',
    whiteSpace: 'nowrap',
    transitionProperty: 'background-color, border-color, color',
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: tokens.strokeWidthThick,
    },
  },
  large: {
    minHeight: '44px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXL}`,
    borderRadius: tokens.borderRadiusLarge,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
  primary: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': { backgroundColor: tokens.colorBrandBackgroundHover, color: tokens.colorNeutralForegroundOnBrand },
    ':active': { backgroundColor: tokens.colorBrandBackgroundPressed },
  },
  secondary: {
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderColor(tokens.colorNeutralStroke1),
    color: tokens.colorNeutralForeground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      color: tokens.colorNeutralForeground1Hover,
    },
    ':active': { backgroundColor: tokens.colorNeutralBackground1Pressed },
  },
  subtle: {
    backgroundColor: tokens.colorSubtleBackground,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightRegular,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover, color: tokens.colorNeutralForeground2Hover },
    ':active': { backgroundColor: tokens.colorSubtleBackgroundPressed },
  },
  icon: { display: 'inline-flex', fontSize: '20px' },
  text: {
    color: tokens.colorBrandForegroundLink,
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { color: tokens.colorBrandForegroundLinkHover },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
});

/** A site page (`/…`) goes through next/link; anything else, such as GitHub or `mailto:`, is a plain link. */
function Anchor({
  href,
  ...rest
}: {
  href: string;
  className: string;
  children: ReactNode;
  'data-appearance'?: string;
  'data-size'?: string;
}) {
  return href.startsWith('/') ? <NextLink href={href} {...rest} /> : <a href={href} {...rest} />;
}

/** How a {@link ButtonLink} looks: Fluent's primary, secondary (outlined) or subtle button. */
export type ButtonLinkAppearance = 'primary' | 'secondary' | 'subtle';

/**
 * A link styled as a Fluent button, for calls to action and navigation. `icon` sits before the text; `size="large"`
 * is for the landing page's calls to action. Appearance and size are exposed as `data-appearance` and `data-size`.
 */
export function ButtonLink({
  href,
  appearance = 'secondary',
  size = 'medium',
  icon,
  className,
  children,
}: {
  href: string;
  appearance?: ButtonLinkAppearance;
  size?: 'medium' | 'large';
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <Anchor
      href={href}
      className={mergeClasses(s.button, s[appearance], size === 'large' && s.large, className)}
      data-appearance={appearance}
      data-size={size}
    >
      {icon && (
        <span className={s.icon} aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </Anchor>
  );
}

/** An inline link in running text, in Fluent's link color. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <Anchor href={href} className={s.text}>
      {children}
    </Anchor>
  );
}
