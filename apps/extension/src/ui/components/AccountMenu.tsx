import {
  Avatar,
  Body1Strong,
  Caption1,
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
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronUpDown16Regular,
  CloudLink20Regular,
  CloudOff20Regular,
  Open20Regular,
  SignOut20Regular,
} from '@fluentui/react-icons';
import { PAIRING_PAGE } from '../../cloud/config';
import { FORGOTTEN_HERE, disconnect } from '../../cloud/sync';
import type { Account } from '../../shared/types';
import { toast } from '../hooks';
import type { PageId } from '../navigation';
import { useConnection } from './CloudCard';

/** X's own sign-out page: X asks to confirm. Xomoni never handles X's password or session (ADR-0003). */
export const X_SIGN_OUT = 'https://x.com/logout';

const useStyles = makeStyles({
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalMNudge,
    width: '100%',
    minWidth: 0,
    padding: tokens.spacingVerticalXS,
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  text: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  truncate: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  chevron: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
});

/**
 * The account corner of the sidebar. It names the X account Xomoni works on, and opens a menu for it and for
 * the xomoni.com connection, the two things a person may mean by "signing out":
 * - Open the X profile, or sign out of X on X's own page. Xomoni uses whichever X account this browser is signed
 *   in to, and never handles its password.
 * - See which xomoni.com account this browser reports to, open the dashboard there, or disconnect. When it isn't
 *   connected, the menu offers to connect, in Settings.
 */
export function AccountMenu({ account, navigate }: { account: Account; navigate: (page: PageId) => void }) {
  const styles = useStyles();
  const connection = useConnection();
  const name = account.name || account.handle;

  const onDisconnect = async () => {
    const result = await disconnect().catch(() => 'forgotten-here' as const);
    if (result === 'forgotten-here') toast(FORGOTTEN_HERE, 'critical');
    else toast('Disconnected from xomoni.com');
  };

  return (
    <Menu positioning="above-start">
      <MenuTrigger disableButtonEnhancement>
        <button type="button" className={styles.trigger} aria-label={`Accounts: ${name}, @${account.handle}`}>
          {/* Decorative: the name is written next to it. Without a picture, the initial stands in. */}
          <Avatar
            aria-hidden
            size={32}
            image={account.avatar ? { src: account.avatar } : undefined}
            initials={account.avatar ? undefined : (name || '?').slice(0, 1).toUpperCase()}
          />
          <span className={styles.text}>
            <Body1Strong className={styles.truncate}>{name}</Body1Strong>
            <Caption1 className={mergeClasses(styles.truncate, styles.muted)}>@{account.handle}</Caption1>
          </span>
          <ChevronUpDown16Regular className={styles.chevron} aria-hidden />
        </button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>X account: @{account.handle}</MenuGroupHeader>
            <MenuItemLink
              href={`https://x.com/${account.handle}`}
              target="_blank"
              rel="noreferrer noopener"
              icon={<Open20Regular />}
            >
              Open your profile on X
            </MenuItemLink>
            <MenuItemLink
              href={X_SIGN_OUT}
              target="_blank"
              rel="noreferrer noopener"
              icon={<SignOut20Regular />}
              secondaryContent="Jobs wait until you sign in again"
            >
              Sign out of X
            </MenuItemLink>
          </MenuGroup>
          <MenuDivider />
          <MenuGroup>
            {connection ? (
              <>
                <MenuGroupHeader>
                  xomoni.com: {connection.account || connection.deviceName}
                  {connection.confirmed ? '' : ' (not confirmed)'}
                </MenuGroupHeader>
                {connection.confirmed ? (
                  <MenuItemLink href={PAIRING_PAGE} target="_blank" rel="noreferrer noopener" icon={<Open20Regular />}>
                    Open your dashboard on xomoni.com
                  </MenuItemLink>
                ) : (
                  <MenuItem icon={<CloudLink20Regular />} onClick={() => navigate('settings')}>
                    Confirm the account in Settings
                  </MenuItem>
                )}
                <MenuItem icon={<CloudOff20Regular />} onClick={() => void onDisconnect()}>
                  Disconnect from xomoni.com
                </MenuItem>
              </>
            ) : (
              <>
                <MenuGroupHeader>xomoni.com: not connected</MenuGroupHeader>
                <MenuItem icon={<CloudLink20Regular />} onClick={() => navigate('settings')}>
                  Connect to xomoni.com
                </MenuItem>
              </>
            )}
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
