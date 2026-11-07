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
import { Board20Regular, PersonSettings20Regular, SignOut20Regular } from '@fluentui/react-icons';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { watchSessionEmail } from '@/shared/supabase/browser-session';
import { ButtonLink } from './links';

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
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => watchSessionEmail(setEmail), []);

  if (email === undefined) return <span className={s.placeholder} aria-hidden data-testid="account-loading" />;
  if (email === null) {
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
      <AccountMenu email={email} />
    </span>
  );
}

/** The menu of a signed-in person. Signing out posts the form the server expects, from this page (Origin checked). */
function AccountMenu({ email }: { email: string }) {
  const s = useStyles();
  const signOut = useRef<HTMLFormElement>(null);
  const name = email || 'your account';
  return (
    <>
      <Menu positioning="below-end">
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            shape="circular"
            aria-label={`Account menu for ${name}`}
            icon={<Avatar name={email || undefined} size={28} color="colorful" />}
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
