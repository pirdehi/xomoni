'use client';
// Reach on xomoni.com (#431, ADR-0045 point 6, ADR-0028 as amended): Xomoni's Reach for the active X account, read in
// this browser (`what: 'reach'`) for the period and the order the person picks, 100 posts at a time. What it shows is
// X content: it stays in this page's memory, and is never stored, logged or sent. Nothing here starts anything on X or
// leads to a cleanup (ADR-0006). Without Xomoni here, it says where Reach lives and offers the dialog of ADR-0027. On
// Fluent UI (ADR-0019).
import { Badge, Button, Spinner, Tab, TabList, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { ArrowDownload16Regular } from '@fluentui/react-icons';
import { REACH_LIMITS, REACH_ORDERS, REACH_RANGES, type ReachOrder, type ReachRange } from '@xomoni/bridge';
import { useState } from 'react';
import { OpenInXomoni, type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import { REACH_ORDER_WORDS, hasReach, rangeIsPlus, rangeWords, reachPostsCsv } from '../domain/reach';
import { ReachView } from './reach-view';
import { download } from './reports-place';
import { NoAnswer, NotHere, Notice } from './xomoni-places';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM, minWidth: 0 },
  // The periods and the orders wrap on a phone rather than push the page sideways.
  tabs: { flexWrap: 'wrap', maxWidth: '100%' },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
});

/** What the page says while Xomoni knows no post's views and no month of X's labels. */
export const REACH_EMPTY_WORDS =
  'Xomoni doesn’t know how many times any of your posts was seen yet. In Xomoni, import your X analytics export (it needs X Premium) on the Vault page, or open your profile on X so Xomoni sees your views.';

/** The period a tab names (`'30'`, … `'null'` for everything); the free 30 days for anything else. */
const rangeOf = (value: unknown): ReachRange => {
  const picked = REACH_RANGES.find((r) => String(r) === value);
  return picked === undefined ? 30 : picked;
};

/** The range of posts shown, as "Posts 1–100 of 342", or null when there are none. */
export function pageWords(offset: number, shown: number, total: number): string | null {
  if (!shown) return null;
  return `Posts ${(offset + 1).toLocaleString('en-US')}–${(offset + shown).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
}

/**
 * *Reach*: the period (the last 30 days free; longer as *Plus · preview*), the posts' order, Xomoni's answer drawn by
 * `ReachView`, the posts 100 at a time with *Previous 100* and *Next 100*, the posts shown as CSV made in the browser,
 * and *Open Reach in Xomoni*. Each choice asks Xomoni again; nothing is kept when the page closes.
 */
export function ReachPlace({ xomoni }: { xomoni: XomoniControls }) {
  const s = useStyles();
  const [rangeDays, setRangeDays] = useState<ReachRange>(30);
  const [order, setOrder] = useState<ReachOrder>('best');
  const [offset, setOffset] = useState(0);
  const { answer, loading, reload } = useXomoniRead(xomoni, { what: 'reach', rangeDays, order, offset });

  if (xomoni.presence.kind !== 'here')
    return (
      <NotHere
        xomoni={xomoni}
        page="reach"
        what="Reach"
        open="Open Reach in Xomoni"
        says="Reach is read from Xomoni on your computer, in this browser, from X’s own numbers it keeps: it never reaches our servers. Open this page in the browser where Xomoni runs, signed in to this account."
      />
    );

  const summary = answer?.ok && answer.what === 'reach' ? answer.reach : null;
  const range = (next: ReachRange) => {
    setRangeDays(next);
    setOffset(0);
  };
  const sort = (next: ReachOrder) => {
    setOrder(next);
    setOffset(0);
  };
  const shown = summary ? pageWords(offset, summary.posts.length, summary.total) : null;

  return (
    <div className={s.root}>
      <Notice>
        Read from Xomoni in this browser: nothing here reaches our servers. Suspected posts are always guesses.
      </Notice>
      <div className={s.row}>
        <TabList
          className={s.tabs}
          aria-label="Period"
          selectedValue={String(rangeDays)}
          onTabSelect={(_, data) => range(rangeOf(data.value))}
        >
          {REACH_RANGES.map((r) => (
            <Tab key={String(r)} value={String(r)}>
              {rangeWords(r)}
            </Tab>
          ))}
        </TabList>
        {rangeIsPlus(rangeDays) && (
          <Badge appearance="tint" color="brand" size="small">
            Plus · preview
          </Badge>
        )}
      </div>
      <div className={s.row}>
        <TabList
          className={s.tabs}
          aria-label="Order"
          size="small"
          selectedValue={order}
          onTabSelect={(_, data) => sort(REACH_ORDERS.find((o) => o === data.value) ?? 'best')}
        >
          {REACH_ORDERS.map((o) => (
            <Tab key={o} value={o}>
              {REACH_ORDER_WORDS[o]}
            </Tab>
          ))}
        </TabList>
        {loading && <Spinner size="extra-tiny" labelPosition="after" label="Reading Reach…" />}
      </div>

      {answer && !answer.ok ? (
        <>
          <NoAnswer reason={answer.reason} doing="show Reach" about="Reach" />
          <div className={s.row}>
            <Button onClick={reload}>Try again</Button>
          </div>
        </>
      ) : !summary ? null : !hasReach(summary) ? (
        <p className={s.text}>{REACH_EMPTY_WORDS}</p>
      ) : (
        <>
          <ReachView summary={summary} handle="" />
          <div className={s.row}>
            {shown && (
              <span className={s.meta} role="status">
                {shown}
              </span>
            )}
            {offset > 0 && (
              <Button onClick={() => setOffset(Math.max(0, offset - REACH_LIMITS.posts))}>Previous 100</Button>
            )}
            {offset + summary.posts.length < summary.total && (
              <Button onClick={() => setOffset(offset + REACH_LIMITS.posts)}>Next 100</Button>
            )}
            {summary.posts.length > 0 && (
              <Button
                icon={<ArrowDownload16Regular />}
                onClick={() => download('xomoni-reach.csv', reachPostsCsv(summary.posts, ''))}
              >
                Download these posts (CSV)
              </Button>
            )}
          </div>
        </>
      )}
      <div className={s.row}>
        <OpenInXomoni xomoni={xomoni} page="reach" label="Open Reach in Xomoni" />
      </div>
    </div>
  );
}
