'use client';
// The getting-started checklist (#244) on /welcome, /install and an empty dashboard: three steps, each ticked from what
// the page sees by itself, and the one thing to do next. On /install it looks again every few seconds (#299), so it
// ticks as soon as Xomoni shows up. On Fluent UI (ADR-0019).
import { makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import { CheckmarkCircle20Filled, Circle20Regular } from '@fluentui/react-icons';
import { Spinner } from '@fluentui/react-components';
import { type ReactNode, useEffect, useId } from 'react';
import { INSTALL_URL } from '@/shared/config/site';
import { ButtonLink } from '@/shared/ui/links';
import { useSession } from '@/shared/ui/use-session';
import { requestLinkCheck } from '../client/extension-session';
import { gettingStarted, nextStep } from '../domain/getting-started';
import { useExtensionLink } from './extension-session-sync';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  heading: { ...typographyStyles.subtitle1, margin: 0, color: tokens.colorNeutralForeground1 },
  list: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  step: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS, ...typographyStyles.body1 },
  icon: { flexShrink: 0 },
  done: { color: tokens.colorPaletteGreenForeground1 },
  todo: { color: tokens.colorNeutralForeground3 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  hint: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground3 },
});

/** How often a live checklist looks for Xomoni again (#299). A look is one message to Xomoni, if the site knows it. */
export const LIVE_CHECK_MS = 3_000;

/**
 * While `active`, asks the page's sync to look for Xomoni again every `everyMs` while the page is in view (#299), so
 * the checklist ticks within seconds of Xomoni opening xomoni.com in another tab. A hidden page waits: it looks again
 * when it comes back into view anyway.
 */
export function useLiveLinkCheck(active: boolean, everyMs = LIVE_CHECK_MS): void {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') requestLinkCheck();
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
}

/**
 * Where Xomoni stands in this browser, in three steps, with a button for the next one. `next` is the page to come back
 * to after signing in or up (this page). `showDashboard` adds *Open your dashboard* once all is done; `actions={false}`
 * shows the steps alone, where the page has its own buttons (the dashboard's setup bar).
 *
 * `live` looks for Xomoni again every few seconds until every step is done (#299). `heading` titles the checklist with
 * a visible heading, which names it for screen readers too (else it is *Getting started*). `installHint` replaces
 * *Install Xomoni* when the next step is installing, on the page that already shows how (/install).
 * The steps are announced politely as they tick.
 */
export function GettingStarted({
  next,
  showDashboard = false,
  actions = true,
  live = false,
  heading,
  installHint,
}: {
  next: string;
  showDashboard?: boolean;
  actions?: boolean;
  live?: boolean;
  heading?: string;
  installHint?: ReactNode;
}) {
  const s = useStyles();
  const headingId = useId();
  const link = useExtensionLink();
  const person = useSession();
  const steps = gettingStarted(link.status, person === undefined ? null : person !== null);
  const todo = nextStep(steps);
  const allDone = steps.every((step) => step.state === 'done');
  useLiveLinkCheck(live && !allDone);
  const back = encodeURIComponent(next);
  return (
    <section className={s.root} {...(heading ? { 'aria-labelledby': headingId } : { 'aria-label': 'Getting started' })}>
      {heading && (
        <h2 id={headingId} className={s.heading}>
          {heading}
        </h2>
      )}
      <ol className={s.list} aria-live="polite">
        {steps.map((step) => (
          <li key={step.id} className={s.step}>
            {step.state === 'done' ? (
              <CheckmarkCircle20Filled className={mergeClasses(s.icon, s.done)} aria-hidden />
            ) : step.state === 'checking' ? (
              <Spinner className={s.icon} size="extra-tiny" aria-hidden />
            ) : (
              <Circle20Regular className={mergeClasses(s.icon, s.todo)} aria-hidden />
            )}
            <span>
              {step.label}
              <span className={s.todo}>
                {step.state === 'done' ? ': done' : step.state === 'checking' ? ': checking…' : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {actions && (
        <div className={s.actions}>
          {todo?.id === 'installed' &&
            (installHint ? (
              <p className={s.hint}>{installHint}</p>
            ) : (
              <ButtonLink href={INSTALL_URL} appearance="primary">
                Install Xomoni
              </ButtonLink>
            ))}
          {todo?.id === 'account' && (
            <>
              <ButtonLink href={`/signup?next=${back}`} appearance="primary">
                Create a free account
              </ButtonLink>
              <ButtonLink href={`/login?next=${back}`}>Sign in</ButtonLink>
            </>
          )}
          {todo?.id === 'connected' && (
            <p className={s.hint}>
              Xomoni signs in with you by itself in this browser. If it hasn’t, open Xomoni and press{' '}
              <strong>Sign in to xomoni.com</strong> once.
            </p>
          )}
          {!todo && showDashboard && allDone && (
            <ButtonLink href="/dashboard" appearance="primary">
              Open your dashboard
            </ButtonLink>
          )}
        </div>
      )}
    </section>
  );
}
