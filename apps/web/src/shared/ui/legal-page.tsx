'use client';
// The privacy policy, terms and risks pages: plain HTML text from the route, set in Fluent's type ramp (ADR-0019).
import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { CalendarLtr16Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from './site-chrome';

const useStyles = makeStyles({
  hero: {
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundImage: `radial-gradient(60% 100% at 50% 0%, ${tokens.colorBrandBackground2} 0%, transparent 100%)`,
  },
  heroInner: {
    boxSizing: 'border-box',
    maxWidth: '768px',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalL}`,
    '@media (min-width: 640px)': { padding: `56px ${tokens.spacingHorizontalXXL}` },
  },
  title: {
    ...typographyStyles.title1,
    margin: 0,
    color: tokens.colorNeutralForeground1,
    letterSpacing: '-0.02em',
    '@media (min-width: 640px)': { ...typographyStyles.largeTitle, letterSpacing: '-0.02em' },
  },
  updated: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalM} 0 0`,
    color: tokens.colorNeutralForeground3,
    ...typographyStyles.caption1,
  },
  main: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '768px',
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
    '& p': { margin: 0 },
    '& * + p': { marginTop: tokens.spacingVerticalM },
    '& ul': {
      margin: `${tokens.spacingVerticalS} 0 0`,
      paddingLeft: tokens.spacingHorizontalXL,
      listStyleType: 'disc',
    },
    '& li + li': { marginTop: tokens.spacingVerticalSNudge },
    '& li::marker': { color: tokens.colorBrandForeground1 },
    '& a': {
      color: tokens.colorBrandForegroundLink,
      textUnderlineOffset: '2px',
      borderRadius: tokens.borderRadiusSmall,
    },
    '& a:hover': { color: tokens.colorBrandForegroundLinkHover },
    '& a:focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
    '& strong': { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
    '& code': {
      padding: `0 ${tokens.spacingHorizontalXS}`,
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground2,
      color: tokens.colorNeutralForeground1,
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: '0.9em',
    },
  },
});

/**
 * Shared layout for the privacy policy, terms and risks: header, a dated title, the text and the footer. The route
 * writes plain `h2`, `p`, `ul`, `a`, `strong` and `code`; this layout styles them.
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <>
      <SiteHeader />
      <main>
        <div className={s.hero}>
          <div className={s.heroInner}>
            <h1 className={s.title}>{title}</h1>
            <p className={s.updated}>
              <CalendarLtr16Regular aria-hidden />
              Last updated {updated}
            </p>
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
