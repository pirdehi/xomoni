import { Body1, Link, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowDownload20Regular, Open16Regular, ShieldError20Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { RELEASES_URL, currentUpdateNotice, dismissUpdate } from '../../cloud/release';
import { OneClickUpdate, UpdateRecovery } from './OneClickUpdate';
import { Button, Callout } from './ui';

const useStyles = makeStyles({
  notice: { marginBlockEnd: tokens.spacingVerticalL },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalS,
    marginBlockStart: tokens.spacingVerticalXS,
  },
});

/**
 * Says that a newer version of the extension is out, as xomoni.com answered this browser's last status report
 * (#151), with a link to the release page and, for a zip install, the one-click update (#305, `OneClickUpdate`). A
 * release that fixes a vulnerability says so and can't be dismissed; any other can be, until a newer one is out.
 * Shows nothing for a browser that isn't connected, but what `UpdateRecovery` has to say after an update. The notice
 * shows in a polite live region, there before it is, so a screen reader reads it out as it appears, once it has
 * finished what it was saying (#457).
 */
export function UpdateNotice() {
  const current = chrome.runtime.getManifest().version;
  const notice = useLiveQuery(async () => currentUpdateNotice(current), [current]);
  return (
    <>
      <UpdateRecovery />
      <div aria-live="polite">
        {notice && <NewVersion version={notice.version} security={notice.security} current={current} />}
      </div>
    </>
  );
}

/** The callout for a newer version. */
function NewVersion({ version, security, current }: { version: string; security: boolean; current: string }) {
  const styles = useStyles();
  const notice = { version, security };
  return (
    <div className={styles.notice}>
      <Callout
        tone={notice.security ? 'critical' : 'accent'}
        icon={notice.security ? <ShieldError20Regular /> : <ArrowDownload20Regular />}
        title={`Xomoni ${notice.version} is out${notice.security ? ', with a security fix' : ''}`}
      >
        <Body1 as="p" block>
          This browser runs {current}.{' '}
          {notice.security
            ? 'Update soon: the new version fixes a security problem.'
            : 'Updating takes a minute: download the new version and load it in place of this one.'}
        </Body1>
        <OneClickUpdate version={notice.version} />
        <div className={styles.row}>
          <Link href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
            Download {notice.version} <Open16Regular aria-hidden />
          </Link>
          {!notice.security && (
            <Button size="sm" variant="ghost" onClick={() => void dismissUpdate(notice.version)}>
              Not now
            </Button>
          )}
        </div>
      </Callout>
    </div>
  );
}
