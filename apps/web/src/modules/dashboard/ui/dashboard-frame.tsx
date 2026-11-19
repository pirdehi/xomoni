'use client';
// The dashboard's frame (#245, docs/DASHBOARD-PLAN-2026-11-19.md): every place in a sidebar on a computer, a bottom
// bar on a phone, and the account and period pickers on every page, kept in the address. On Fluent UI (ADR-0019).
import {
  Badge,
  Button,
  Menu,
  MenuItemLink,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  makeStyles,
  mergeClasses,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  Comment20Regular,
  DataTrending20Regular,
  DocumentBulletList20Regular,
  DocumentText20Regular,
  type FluentIcon,
  Heart20Regular,
  History20Regular,
  Home20Regular,
  Laptop20Regular,
  Library20Regular,
  MoreHorizontal20Regular,
  People20Regular,
  Search20Regular,
  Settings20Regular,
  ShieldCheckmark20Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PERIODS, type Period, type Scope, parseScope, scopeQuery } from '../domain/scope';
import { GROUPS, SECTIONS, type Section, type SectionId, sectionHref } from '../domain/sections';

/** Each place's icon. */
export const SECTION_ICON: Record<SectionId, FluentIcon> = {
  overview: Home20Regular,
  audience: People20Regular,
  content: DocumentText20Regular,
  engagement: Heart20Regular,
  reports: DocumentBulletList20Regular,
  library: Library20Regular,
  comments: Comment20Regular,
  cleanup: Sparkle20Regular,
  watch: Search20Regular,
  activity: History20Regular,
  health: ShieldCheckmark20Regular,
  browsers: Laptop20Regular,
  settings: Settings20Regular,
};

/** The phone's bottom bar: the three places people open most, and *More* for the rest. */
const PHONE_BAR: readonly { id: SectionId; label: string; icon: FluentIcon }[] = [
  { id: 'overview', label: 'Overview', icon: Home20Regular },
  { id: 'audience', label: 'Insights', icon: DataTrending20Regular },
  { id: 'comments', label: 'Comments', icon: Comment20Regular },
];

/** Wide enough for the sidebar beside the page. */
const WIDE = '@media (min-width: 1024px)';

const useStyles = makeStyles({
  frame: {
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    width: '100%',
    // The header's width and side padding, so the sidebar lines up with the logo.
    maxWidth: '1152px',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL} 96px`,
    gap: tokens.spacingHorizontalXXL,
    '@media (min-width: 640px)': { paddingInline: tokens.spacingHorizontalXXL },
    [WIDE]: {
      gridTemplateColumns: '200px minmax(0, 1fr)',
      gap: '40px',
      padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
    },
  },
  sidebar: {
    display: 'none',
    [WIDE]: {
      display: 'flex',
      flexDirection: 'column',
      rowGap: tokens.spacingVerticalL,
      position: 'sticky',
      top: '88px',
      alignSelf: 'start',
    },
  },
  group: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS, margin: 0, padding: 0 },
  groupLabel: {
    ...typographyStyles.caption1Strong,
    margin: `0 0 ${tokens.spacingVerticalXS}`,
    paddingInline: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  item: { listStyleType: 'none' },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    textDecorationLine: 'none',
    ...typographyStyles.body1,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover, color: tokens.colorNeutralForeground1 },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  current: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    fontWeight: tokens.fontWeightSemibold,
    ':hover': { backgroundColor: tokens.colorBrandBackground2Hover, color: tokens.colorBrandForeground2 },
  },
  linkLabel: { flexGrow: 1 },
  main: { minWidth: 0, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXL },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
  },
  heading: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS, minWidth: 0 },
  title: { ...typographyStyles.title2, margin: 0, color: tokens.colorNeutralForeground1 },
  summary: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground3 },
  // On a phone the two pickers share a row, each half of it, under the live state.
  pickers: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    width: '100%',
    '@media (min-width: 640px)': { width: 'auto' },
  },
  picker: { flex: '1 1 140px', '@media (min-width: 640px)': { flex: '0 0 auto' } },
  live: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    ...typographyStyles.caption1,
    color: tokens.colorNeutralForeground3,
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralForeground4,
  },
  dotOn: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  liveRow: { flexBasis: '100%', '@media (min-width: 640px)': { flexBasis: 'auto' } },
  // On a phone, the other places of the current group, as a row of links above the page.
  tabs: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    overflowX: 'auto',
    margin: 0,
    padding: 0,
    [WIDE]: { display: 'none' },
  },
  tab: {
    flexShrink: 0,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    textDecorationLine: 'none',
    ...typographyStyles.caption1Strong,
  },
  tabCurrent: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
    color: tokens.colorBrandForeground2,
  },
  phoneBar: {
    position: 'fixed',
    insetInline: 0,
    bottom: 0,
    zIndex: 20,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    paddingBottom: 'env(safe-area-inset-bottom)',
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    [WIDE]: { display: 'none' },
  },
  phoneItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    minHeight: '56px',
    border: 'none',
    background: 'none',
    color: tokens.colorNeutralForeground3,
    textDecorationLine: 'none',
    ...typographyStyles.caption2,
    cursor: 'pointer',
  },
  phoneCurrent: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
});

/** The scope in the address, and a function that changes it in place. */
export function useScope(): [Scope, (next: Scope) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const scope = parseScope(new URLSearchParams(params.toString()));
  const change = (next: Scope) => {
    const query = scopeQuery(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return [scope, change];
}

/**
 * The frame around every place of the dashboard (#245):
 * - a sidebar of every place in four groups on a computer, with *Soon* on places not built yet;
 * - a bottom bar on a phone (*Overview, Insights, Comments, More*), and the current group's places as a row of links;
 * - the place's title and purpose, the account and period pickers (kept in the address), and whether the page is
 *   live.
 * Links keep the account and period.
 */
export function DashboardFrame({
  section,
  accounts,
  live,
  children,
}: {
  section: Section;
  /** The X accounts to pick from. */
  accounts: readonly string[];
  /** Whether the live feed is connected. */
  live: boolean;
  children: ReactNode;
}) {
  const s = useStyles();
  const [scope, setScope] = useScope();
  const query = scopeQuery(scope);
  const siblings = SECTIONS.filter((other) => other.group === section.group);

  return (
    <div className={s.frame}>
      <nav className={s.sidebar} aria-label="Dashboard">
        {GROUPS.map((group) => (
          <div key={group.id}>
            {group.id !== 'overview' && <p className={s.groupLabel}>{group.label}</p>}
            <ul className={s.group}>
              {SECTIONS.filter((item) => item.group === group.id).map((item) => {
                const Icon = SECTION_ICON[item.id];
                const current = item.id === section.id;
                return (
                  <li key={item.id} className={s.item}>
                    <Link
                      href={sectionHref(item.id, query)}
                      className={mergeClasses(s.link, current && s.current)}
                      aria-current={current ? 'page' : undefined}
                    >
                      <Icon aria-hidden />
                      <span className={s.linkLabel}>{item.label}</span>
                      {!item.ready && (
                        <Badge appearance="tint" color="informative" size="small">
                          Soon
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={s.main}>
        {siblings.length > 1 && (
          <nav aria-label={GROUPS.find((g) => g.id === section.group)?.label}>
            <ul className={s.tabs}>
              {siblings.map((item) => (
                <li key={item.id} className={s.item}>
                  <Link
                    href={sectionHref(item.id, query)}
                    className={mergeClasses(s.tab, item.id === section.id && s.tabCurrent)}
                    aria-current={item.id === section.id ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className={s.toolbar}>
          <div className={s.heading}>
            <h1 className={s.title}>{section.label}</h1>
            <p className={s.summary}>{section.summary}</p>
          </div>
          <div className={s.pickers}>
            <span className={mergeClasses(s.live, s.liveRow)} role="status">
              <span className={mergeClasses(s.dot, live && s.dotOn)} aria-hidden />
              {live ? 'Live' : 'Connecting…'}
            </span>
            <Select
              className={s.picker}
              aria-label="X account"
              value={scope.account ?? ''}
              onChange={(_, data) => setScope({ ...scope, account: data.value || null })}
            >
              <option value="">All accounts</option>
              {accounts.map((handle) => (
                <option key={handle} value={handle}>
                  @{handle}
                </option>
              ))}
            </Select>
            <Select
              className={s.picker}
              aria-label="Period"
              value={scope.period}
              onChange={(_, data) => setScope({ ...scope, period: data.value as Period })}
            >
              {PERIODS.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {children}
      </div>

      <nav className={s.phoneBar} aria-label="Dashboard, on a phone">
        {PHONE_BAR.map((item) => {
          const Icon = item.icon;
          const current = SECTIONS.find((x) => x.id === item.id)?.group === section.group;
          return (
            <Link
              key={item.id}
              href={sectionHref(item.id, query)}
              className={mergeClasses(s.phoneItem, current && s.phoneCurrent)}
              aria-current={item.id === section.id ? 'page' : undefined}
            >
              <Icon aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <Menu positioning="above-end">
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="transparent" className={s.phoneItem} icon={<MoreHorizontal20Regular />}>
              More
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {SECTIONS.map((item) => {
                const Icon = SECTION_ICON[item.id];
                return (
                  <MenuItemLink key={item.id} href={sectionHref(item.id, query)} icon={<Icon />}>
                    {item.label}
                  </MenuItemLink>
                );
              })}
            </MenuList>
          </MenuPopover>
        </Menu>
      </nav>
    </div>
  );
}
