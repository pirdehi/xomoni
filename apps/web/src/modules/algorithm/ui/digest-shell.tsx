'use client';
// The frame of the algorithm digest's pages (#430): the site's header, a title with one line under it, the text, and
// the footer, on Fluent's tokens (ADR-0019). Plain text only: nothing here renders HTML from a digest.
import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

const useStyles = makeStyles({
  hero: {
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundImage: `radial-gradient(60% 100% at 50% 0%, ${tokens.colorBrandBackground2} 0%, transparent 100%)`,
  },
  inner: {
    boxSizing: 'border-box',
    maxWidth: '880px',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalL}`,
    '@media (min-width: 640px)': { padding: `56px ${tokens.spacingHorizontalXXL}` },
  },
  eyebrow: {
    ...typographyStyles.caption1Strong,
    margin: `0 0 ${tokens.spacingVerticalS}`,
    color: tokens.colorBrandForeground1,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  title: {
    ...typographyStyles.title1,
    margin: 0,
    color: tokens.colorNeutralForeground1,
    letterSpacing: '-0.02em',
    overflowWrap: 'anywhere',
    '@media (min-width: 640px)': { ...typographyStyles.largeTitle, letterSpacing: '-0.02em' },
  },
  lead: {
    ...typographyStyles.body2,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground2,
  },
  main: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '880px',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL} 64px`,
    '@media (min-width: 640px)': { padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXXL} 80px` },
  },
  prose: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: '1.7',
    '& h2': {
      ...typographyStyles.subtitle1,
      margin: `${tokens.spacingVerticalXXXL} 0 ${tokens.spacingVerticalM}`,
      color: tokens.colorNeutralForeground1,
    },
    '& h2:first-child': { marginTop: 0 },
    '& p': { margin: 0 },
    '& * + p': { marginTop: tokens.spacingVerticalM },
    '& ul': { margin: `${tokens.spacingVerticalS} 0 0`, paddingLeft: tokens.spacingHorizontalXL },
    '& li + li': { marginTop: tokens.spacingVerticalSNudge },
    '& li::marker': { color: tokens.colorBrandForeground1 },
    // Underlined: in running text, a link's color alone is too close to the text around it (WCAG 1.4.1, #342).
    '& a': {
      color: tokens.colorBrandForegroundLink,
      textDecorationLine: 'underline',
      textUnderlineOffset: '2px',
      borderRadius: tokens.borderRadiusSmall,
    },
    '& a:hover': { color: tokens.colorBrandForegroundLinkHover },
    '& a:focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
    '& strong': { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
    // File and parameter names are long and unbroken: they wrap anywhere rather than push the page sideways.
    '& code': {
      padding: `0 ${tokens.spacingHorizontalXS}`,
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground2,
      color: tokens.colorNeutralForeground1,
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: '0.9em',
      overflowWrap: 'anywhere',
    },
  },
});

/** The frame of a digest page: `eyebrow` above the title, `lead` under it, and the text (`children`) below. */
export function DigestShell({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <>
      <SiteHeader />
      <main>
        <div className={s.hero}>
          <div className={s.inner}>
            <p className={s.eyebrow}>{eyebrow}</p>
            <h1 className={s.title}>{title}</h1>
            <p className={s.lead}>{lead}</p>
          </div>
        </div>
        <div className={s.main}>
          <div className={s.prose}>{children}</div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
