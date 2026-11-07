import {
  Avatar,
  Body1Strong,
  Caption1,
  Button as FluentButton,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowRight16Regular,
  ChevronUpDown16Regular,
  CloudOff16Regular,
  Globe20Regular,
  Open16Regular,
  SignOut20Regular,
} from '@fluentui/react-icons';
import { useState } from 'react';
import { PAIRING_PAGE } from '../../cloud/config';
import { FORGOTTEN_HERE, disconnect } from '../../cloud/sync';
import type { Account } from '../../shared/types';
import { type WorkerStatus, toast } from '../hooks';
import type { PageId } from '../navigation';
import { useConnection } from './CloudCard';
import { type CloudLink, ConnectionMap, xLinkOf } from './ConnectionMap';
import { Badge, Button } from './ui';

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
  open: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  text: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  truncate: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  chevron: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  surface: {
    width: '360px',
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusXLarge,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
  },
  head: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS },
  section: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0 },
  grow: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  icon: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: '32px',
    height: '32px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  note: { color: tokens.colorNeutralForeground3 },
  // A state badge stays on one line, whatever room the name beside it takes.
  badge: { flexShrink: 0, whiteSpace: 'nowrap' },
});

/**
 * The account corner of the sidebar and the panel it opens. The panel shows how this browser links X and
 * xomoni.com (`ConnectionMap`), then one card for each, with its state and what can be done:
 * - X: the account Xomoni works on, its profile, and X's own sign-out page. Xomoni never handles X's password.
 * - xomoni.com: which account this browser reports to, its dashboard and Disconnect; or, when not connected or not
 *   confirmed, the way to Settings to do so.
 */
export function AccountPanel({
  account,
  worker,
  navigate,
}: {
  account: Account;
  worker: WorkerStatus;
  navigate: (page: PageId) => void;
}) {
  const s = useStyles();
  const connection = useConnection();
  const [open, setOpen] = useState(false);
  const name = account.name || account.handle;
  const x = xLinkOf(worker);
  const cloud: CloudLink = !connection ? 'off' : connection.confirmed ? 'connected' : 'pending';

  const goToSettings = () => {
    setOpen(false);
    navigate('settings');
  };
  const onDisconnect = async () => {
    const result = await disconnect().catch(() => 'forgotten-here' as const);
    if (result === 'forgotten-here') toast(FORGOTTEN_HERE, 'critical');
    else toast('Disconnected from xomoni.com');
  };

  return (
    <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)} positioning="above-start" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <button
          type="button"
          className={mergeClasses(s.trigger, open && s.open)}
          aria-label={`Connections: ${name}, @${account.handle}`}
          aria-expanded={open}
        >
          {/* Decorative: the name is written next to it. Without a picture, the initial stands in. */}
          <Avatar
            aria-hidden
            size={32}
            image={account.avatar ? { src: account.avatar } : undefined}
            initials={account.avatar ? undefined : (name || '?').slice(0, 1).toUpperCase()}
          />
          <span className={s.text}>
            <Body1Strong className={s.truncate}>{name}</Body1Strong>
            <Caption1 className={mergeClasses(s.truncate, s.muted)}>@{account.handle}</Caption1>
          </span>
          <ChevronUpDown16Regular className={s.chevron} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverSurface className={s.surface} aria-label="Connections">
        <div className={s.head}>
          <Subtitle2>Connections</Subtitle2>
          <Caption1 className={s.muted}>How this browser links X and xomoni.com.</Caption1>
        </div>

        <ConnectionMap x={x} cloud={cloud} />

        <section className={s.section} aria-label="X account">
          <div className={s.row}>
            <Avatar
              aria-hidden
              size={32}
              image={account.avatar ? { src: account.avatar } : undefined}
              initials={account.avatar ? undefined : (name || '?').slice(0, 1).toUpperCase()}
            />
            <div className={s.grow}>
              <Body1Strong className={s.truncate}>{name}</Body1Strong>
              <Caption1 className={mergeClasses(s.truncate, s.muted)}>@{account.handle} on X</Caption1>
            </div>
            {x !== 'unknown' && (
              <span className={s.badge}>
                <Badge tone={x === 'signed-in' ? 'good' : 'warn'}>
                  {x === 'signed-in' ? 'Signed in' : 'Signed out'}
                </Badge>
              </span>
            )}
          </div>
          <div className={s.actions}>
            <FluentButton
              as="a"
              href={`https://x.com/${account.handle}`}
              target="_blank"
              rel="noreferrer noopener"
              size="small"
              icon={<Open16Regular />}
            >
              Open profile
            </FluentButton>
            <FluentButton
              as="a"
              href={X_SIGN_OUT}
              target="_blank"
              rel="noreferrer noopener"
              size="small"
              appearance="subtle"
              icon={<SignOut20Regular />}
            >
              Sign out of X
            </FluentButton>
          </div>
          <Caption1 className={s.note}>Signing out of X pauses jobs until you sign in again.</Caption1>
        </section>

        <section className={s.section} aria-label="xomoni.com">
          <div className={s.row}>
            <span className={s.icon} aria-hidden>
              <Globe20Regular />
            </span>
            <div className={s.grow}>
              <Body1Strong>xomoni.com</Body1Strong>
              <Caption1 className={mergeClasses(s.truncate, s.muted)}>
                {connection ? connection.account || connection.deviceName : 'Your jobs, from any device'}
              </Caption1>
            </div>
            <span className={s.badge}>
              {cloud === 'connected' && <Badge tone="good">Connected</Badge>}
              {cloud === 'pending' && <Badge tone="warn">Not confirmed</Badge>}
              {cloud === 'off' && <Badge>Not connected</Badge>}
            </span>
          </div>
          {cloud === 'connected' && (
            <>
              <div className={s.actions}>
                <FluentButton
                  as="a"
                  href={PAIRING_PAGE}
                  target="_blank"
                  rel="noreferrer noopener"
                  size="small"
                  icon={<Open16Regular />}
                >
                  Open dashboard
                </FluentButton>
                <Button size="sm" variant="ghost" icon={<CloudOff16Regular />} onClick={() => void onDisconnect()}>
                  Disconnect
                </Button>
              </div>
              <Caption1 className={s.note}>Only job status is sent: titles, states and counts.</Caption1>
            </>
          )}
          {cloud === 'pending' && (
            <>
              <Caption1 className={s.note}>Check that the account is yours. Nothing is sent until you do.</Caption1>
              <div className={s.actions}>
                <Button size="sm" variant="primary" icon={<ArrowRight16Regular />} onClick={goToSettings}>
                  Confirm in Settings
                </Button>
                <Button size="sm" variant="ghost" icon={<CloudOff16Regular />} onClick={() => void onDisconnect()}>
                  Disconnect
                </Button>
              </div>
            </>
          )}
          {cloud === 'off' && (
            <>
              <Caption1 className={s.note}>
                Get a one-time code on xomoni.com, then type it in Settings. Only job status is sent.
              </Caption1>
              <div className={s.actions}>
                <Button size="sm" variant="primary" icon={<ArrowRight16Regular />} onClick={goToSettings}>
                  Connect this browser
                </Button>
              </div>
            </>
          )}
        </section>
      </PopoverSurface>
    </Popover>
  );
}
