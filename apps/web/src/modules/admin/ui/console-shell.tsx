'use client';

import {
  Button,
  Hamburger,
  NavDrawer,
  NavDrawerBody,
  NavDrawerHeader,
  NavItem,
  makeStyles,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import {
  Board20Regular,
  ClipboardTaskListLtr20Regular,
  DocumentText20Regular,
  History20Regular,
  Map20Regular,
  Open12Regular,
  People20Regular,
  SignOut20Regular,
} from '@fluentui/react-icons';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { CONSOLE_PATHS } from '../domain/routes';

/** Below this width the sidebar folds into a menu button (#516). */
const NARROW = '@media (max-width: 767px)';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    height: '56px',
    padding: `0 ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  menu: { display: 'none', [NARROW]: { display: 'inline-flex' } },
  title: { ...typographyStyles.subtitle2, margin: 0, flexShrink: 0, color: tokens.colorNeutralForeground1 },
  email: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'end',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  signOut: { flexShrink: 0 },
  body: { display: 'flex', flexGrow: 1, minHeight: 0 },
  sidebar: {
    flexShrink: 0,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    [NARROW]: { display: 'none' },
  },
  drawer: { height: 'calc(100vh - 56px)', position: 'sticky', top: '56px' },
  main: {
    flexGrow: 1,
    minWidth: 0,
    padding: `${tokens.spacingVerticalXXL} 32px`,
    [NARROW]: { padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL}` },
  },
  external: { marginInlineStart: tokens.spacingHorizontalXS, verticalAlign: 'middle' },
  drawerEmail: {
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

/** The console's pages in the sidebar, in order. `document` opens the sandboxed product document in a new tab. */
const PAGES = [
  { value: 'overview', href: CONSOLE_PATHS.overview, label: 'Overview', icon: <Board20Regular /> },
  { value: 'users', href: CONSOLE_PATHS.users, label: 'Users', icon: <People20Regular /> },
  { value: 'roadmap', href: CONSOLE_PATHS.roadmap, label: 'Roadmap', icon: <Map20Regular /> },
  { value: 'document', href: CONSOLE_PATHS.document, label: 'Product document', icon: <DocumentText20Regular /> },
  { value: 'documents', href: CONSOLE_PATHS.documents, label: 'Versions', icon: <History20Regular /> },
  { value: 'audit', href: CONSOLE_PATHS.audit, label: 'Audit log', icon: <ClipboardTaskListLtr20Regular /> },
] as const;

/** The sidebar entry for the page at `path`, or an empty string when none matches. */
export function selectedPage(path: string): string {
  if (path === CONSOLE_PATHS.overview) return 'overview';
  const page = PAGES.find(
    (p) => p.href !== CONSOLE_PATHS.overview && (path === p.href || path.startsWith(`${p.href}/`)),
  );
  return page?.value ?? '';
}

/** A click the browser would follow in this tab, with no key held: the router follows it instead. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function ConsoleNav({ onNavigate }: { onNavigate?: () => void }) {
  const s = useStyles();
  const router = useRouter();
  return (
    <>
      {PAGES.map((page) =>
        page.value === 'document' ? (
          <NavItem
            key={page.value}
            as="a"
            value={page.value}
            href={page.href}
            icon={page.icon}
            target="_blank"
            rel="noopener"
            onClick={onNavigate}
          >
            {page.label}
            <Open12Regular className={s.external} aria-label="(opens in a new tab)" />
          </NavItem>
        ) : (
          <NavItem
            key={page.value}
            as="a"
            value={page.value}
            href={page.href}
            icon={page.icon}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              if (!plainClick(event)) return;
              event.preventDefault();
              router.push(page.href);
              onNavigate?.();
            }}
          >
            {page.label}
          </NavItem>
        ),
      )}
    </>
  );
}

/**
 * The super-admin console's frame (#516), on Fluent UI's navigation drawer: a header with the console's name, the
 * signed-in email and *Sign out*, a sidebar of the console's pages, and the page. Below 768 px the sidebar folds into a
 * menu button that opens it over the page. Only drawn for a signed-in super-admin (the layout checks first).
 */
export function ConsoleShell({ email, children }: { email: string; children: ReactNode }) {
  const s = useStyles();
  const selected = selectedPage(usePathname());
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={s.root}>
      <header className={s.header}>
        <Hamburger
          className={s.menu}
          aria-label="Open the console menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        />
        <p className={s.title}>Xomoni console</p>
        <span className={s.email} title={email}>
          {email}
        </span>
        <form action={`/auth/signout?next=${encodeURIComponent(CONSOLE_PATHS.signIn)}`} method="post">
          <Button type="submit" appearance="subtle" icon={<SignOut20Regular />} className={s.signOut}>
            Sign out
          </Button>
        </form>
      </header>
      <div className={s.body}>
        <div className={s.sidebar}>
          <NavDrawer open type="inline" selectedValue={selected} className={s.drawer} aria-label="Console" tabbable>
            <NavDrawerBody>
              <ConsoleNav />
            </NavDrawerBody>
          </NavDrawer>
        </div>
        <main className={s.main}>{children}</main>
      </div>
      <NavDrawer
        open={menuOpen}
        type="overlay"
        selectedValue={selected}
        onOpenChange={(_, data) => setMenuOpen(data.open)}
        aria-label="Console menu"
        tabbable
      >
        <NavDrawerHeader>
          <p className={s.drawerEmail}>{email}</p>
        </NavDrawerHeader>
        <NavDrawerBody>
          <ConsoleNav onNavigate={() => setMenuOpen(false)} />
        </NavDrawerBody>
      </NavDrawer>
    </div>
  );
}
