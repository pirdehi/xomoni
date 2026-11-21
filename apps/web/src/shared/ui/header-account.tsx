'use client';
// The header's account corner on every page: "Sign in" for visitors; the dashboard and an account menu, with
// "Sign out", for signed-in people. Fluent UI (ADR-0019).
import {
  Avatar,
  Button,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemLink,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { getInitials } from '@fluentui/react-avatar';
import { Board20Regular, PersonSettings20Regular, SignOut20Regular } from '@fluentui/react-icons';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { ButtonLink } from './links';
import { useSession } from './use-session';

/** The site's own paths this corner links to; the auth module owns them (`modules/auth/domain/routes.ts`). */
export const ACCOUNT_PATHS = {
  signIn: '/login',
  dashboard: '/dashboard',
  account: '/account',
  signOut: '/auth/signout',
} as const;

const useStyles = makeStyles({
  corner: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  // Keeps the header from jumping while the session is read.
  placeholder: { display: 'inline-block', width: '76px', height: '32px' },
  dashboard: { display: 'none', '@media (min-width: 480px)': { display: 'inline-flex' } },
  email: {
    maxWidth: '240px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  hidden: { display: 'none' },
});

/**
 * "Sign in" for visitors; for signed-in people, a Dashboard button (except on the dashboard) and a menu named after
 * their email with the dashboard, the account page and "Sign out". The session comes from this browser's cookie (`watchSessionEmail`),
 * so it only decides what is shown; a placeholder holds the space until it is read.
 */
export function HeaderAccount() {
  const s = useStyles();
  const pathname = usePathname();
  const person = useSession();

  if (person === undefined) return <span className={s.placeholder} aria-hidden data-testid="account-loading" />;
  if (person === null) {
    return (
      <ButtonLink href={ACCOUNT_PATHS.signIn} appearance="primary">
        Sign in
      </ButtonLink>
    );
  }
  return (
    <span className={s.corner}>
      {pathname !== ACCOUNT_PATHS.dashboard && (
        <span className={s.dashboard}>
          <ButtonLink href={ACCOUNT_PATHS.dashboard} appearance="primary">
            Dashboard
          </ButtonLink>
        </span>
      )}
      <AccountMenu email={person.email} name={person.name} />
    </span>
  );
}

/**
 * The menu of a signed-in person. Its avatar takes the display name's initial and color, as the dashboard's does, and
 * the email's when there is no name (#239). Signing out posts the form the server expects, from this page (Origin
 * checked).
 */
function AccountMenu({ email, name: displayName }: { email: string; name: string }) {
  const s = useStyles();
  const signOut = useRef<HTMLFormElement>(null);
  const name = email || 'your account';
  // The initials the avatar shows (Fluent's own rule), also in the button's name: speech input can then say what it
  // sees (WCAG 2.5.3, #342).
  const initials = getInitials(displayName || email, false);
  return (
    <>
      <Menu positioning="below-end">
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            shape="circular"
            aria-label={`Account menu for ${name}${initials ? ` (${initials})` : ''}`}
            icon={<Avatar name={displayName || email || undefined} size={28} color="colorful" />}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuGroup>
              <MenuGroupHeader>
                Signed in as <span className={s.email}>{name}</span>
              </MenuGroupHeader>
              <MenuItemLink href={ACCOUNT_PATHS.dashboard} icon={<Board20Regular />}>
                Dashboard
              </MenuItemLink>
              <MenuItemLink href={ACCOUNT_PATHS.account} icon={<PersonSettings20Regular />}>
                Account
              </MenuItemLink>
            </MenuGroup>
            <MenuDivider />
            <MenuItem icon={<SignOut20Regular />} onClick={() => signOut.current?.requestSubmit()}>
              Sign out
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <form ref={signOut} action={ACCOUNT_PATHS.signOut} method="post" className={s.hidden} aria-hidden>
        <button type="submit" tabIndex={-1}>
          Sign out
        </button>
      </form>
    </>
  );
}
