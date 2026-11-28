'use client';

import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { ArrowLeft20Regular } from '@fluentui/react-icons';
import { ButtonLink } from '@/shared/ui/links';
import { formatDate, formatNumber, formatWhen } from '../domain/format';
import { tierLabel } from '../domain/overview';
import { CONSOLE_PATHS } from '../domain/routes';
import { providerLabel, userBadges, type UserDetail } from '../domain/users';
import { ConsolePage, UserBadges } from './page-frame';
import { UserActions } from './user-actions';

const useStyles = makeStyles({
  back: { alignSelf: 'flex-start' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.spacingHorizontalM,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  heading: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalS,
    margin: 0,
    '& dt': { color: tokens.colorNeutralForeground3 },
    '& dd': { margin: 0, overflowWrap: 'anywhere' },
  },
  scroller: { overflowX: 'auto' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    ...typographyStyles.body1,
    '& th, & td': {
      textAlign: 'start',
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
      whiteSpace: 'nowrap',
    },
  },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
});

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** A card with a heading. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const s = useStyles();
  return (
    <section className={s.card} aria-label={title}>
      <h2 className={s.heading}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * One account in the console (#516): who it is and how it signs in, its plan and choices, its browsers, its recent jobs
 * (status only, never X content) and its sessions, and what a super-admin can do to it (`UserActions`).
 */
export function UserDetailView({ user, viewerId }: { user: UserDetail; viewerId: string }) {
  const s = useStyles();
  return (
    <ConsolePage title={user.email || user.id} description={<UserBadges badges={userBadges(user)} />}>
      <ButtonLink href={CONSOLE_PATHS.users} appearance="subtle" icon={<ArrowLeft20Regular />} className={s.back}>
        All users
      </ButtonLink>
      <Card title="Actions">
        <UserActions user={user} viewerId={viewerId} />
      </Card>
      <div className={s.grid}>
        <Card title="Account">
          <dl className={s.facts}>
            <dt>User id</dt>
            <dd>{user.id}</dd>
            <dt>Joined</dt>
            <dd>{formatWhen(user.createdAt)}</dd>
            <dt>Last sign-in</dt>
            <dd>{formatWhen(user.lastSignInAt, 'Never')}</dd>
            <dt>Email confirmed</dt>
            <dd>{yesNo(user.confirmed)}</dd>
            <dt>Sign-in methods</dt>
            <dd>{user.providers.map(providerLabel).join(', ') || '—'}</dd>
            <dt>Two-step verification</dt>
            <dd>{user.mfa ? 'On' : 'Off'}</dd>
            <dt>Suspended</dt>
            <dd>{user.banned ? 'Yes, until restored' : 'No'}</dd>
            <dt>Signed-in sessions</dt>
            <dd>{formatNumber(user.sessionCount)}</dd>
          </dl>
        </Card>
        <Card title="Plan and choices">
          <dl className={s.facts}>
            <dt>Plan</dt>
            <dd>
              {user.plan
                ? `${tierLabel(user.plan.tier)}${user.plan.status ? ` (${user.plan.status})` : ''}`
                : tierLabel(null)}
            </dd>
            {user.plan?.validUntil && (
              <>
                <dt>Valid until</dt>
                <dd>{formatDate(user.plan.validUntil)}</dd>
              </>
            )}
            <dt>Daily numbers</dt>
            <dd>{yesNo(user.choices.dailyStats)}</dd>
            <dt>Weekly email</dt>
            <dd>{yesNo(user.choices.weeklyEmail)}</dd>
            <dt>Email when X warns</dt>
            <dd>{yesNo(user.choices.healthAlert)}</dd>
          </dl>
        </Card>
      </div>
      <Card title="Browsers">
        {user.devices.length === 0 ? (
          <p className={s.muted}>No browser connected.</p>
        ) : (
          <div className={s.scroller}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Version</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Connected</th>
                </tr>
              </thead>
              <tbody>
                {user.devices.map((device) => (
                  <tr key={device.id}>
                    <td>{device.name}</td>
                    <td>{device.extensionVersion ?? '—'}</td>
                    <td>{formatWhen(device.lastSeenAt, 'Never')}</td>
                    <td>{formatDate(device.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Recent jobs">
        {user.jobs.length === 0 ? (
          <p className={s.muted}>No job reported.</p>
        ) : (
          <div className={s.scroller}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">X account</th>
                  <th scope="col">State</th>
                  <th scope="col">Done</th>
                  <th scope="col">Failed</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {user.jobs.map((job) => (
                  <tr key={job.id}>
                    <td dir="auto">{job.title || job.kind}</td>
                    <td>{job.xHandle ? `@${job.xHandle}` : '—'}</td>
                    <td>{job.state}</td>
                    <td>{`${formatNumber(job.done)} of ${formatNumber(job.matched)}`}</td>
                    <td>{formatNumber(job.failed)}</td>
                    <td>{formatWhen(job.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {user.sessions.length > 0 && (
        <Card title="Sessions">
          <div className={s.scroller}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Browser</th>
                  <th scope="col">Started</th>
                  <th scope="col">Last active</th>
                  <th scope="col">Level</th>
                </tr>
              </thead>
              <tbody>
                {user.sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.userAgent ?? '—'}</td>
                    <td>{formatWhen(session.createdAt)}</td>
                    <td>{formatWhen(session.updatedAt)}</td>
                    <td>{session.aal === 'aal2' ? 'With a code' : 'Without a code'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </ConsolePage>
  );
}
