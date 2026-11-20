'use client';
// The getting-started checklist (#244) on /welcome, /install and an empty dashboard: three steps, each ticked from what
// the page sees by itself, and the one thing to do next. On Fluent UI (ADR-0019).
import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { CheckmarkCircle20Filled, Circle20Regular } from '@fluentui/react-icons';
import { Spinner } from '@fluentui/react-components';
import { INSTALL_URL } from '@/shared/config/site';
import { ButtonLink } from '@/shared/ui/links';
import { useSession } from '@/shared/ui/use-session';
import { gettingStarted, nextStep } from '../domain/getting-started';
import { useExtensionLink } from './extension-session-sync';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  list: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  step: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS, ...typographyStyles.body1 },
  done: { color: tokens.colorPaletteGreenForeground1 },
  todo: { color: tokens.colorNeutralForeground3 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
});

/**
 * Where Xomoni stands in this browser, in three steps, with a button for the next one. `next` is the page to come back
 * to after signing in or up (this page). `showDashboard` adds *Open your dashboard* once all is done; `actions={false}`
 * shows the steps alone, where the page has its own buttons (the dashboard's setup bar).
 */
export function GettingStarted({
  next,
  showDashboard = false,
  actions = true,
}: {
  next: string;
  showDashboard?: boolean;
  actions?: boolean;
}) {
  const s = useStyles();
  const link = useExtensionLink();
  const person = useSession();
  const steps = gettingStarted(link.status, person === undefined ? null : person !== null);
  const todo = nextStep(steps);
  const back = encodeURIComponent(next);
  return (
    <section className={s.root} aria-label="Getting started">
      <ol className={s.list}>
        {steps.map((step) => (
          <li key={step.id} className={s.step}>
            {step.state === 'done' ? (
              <CheckmarkCircle20Filled className={s.done} aria-hidden />
            ) : step.state === 'checking' ? (
              <Spinner size="extra-tiny" aria-hidden />
            ) : (
              <Circle20Regular className={s.todo} aria-hidden />
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
          {todo?.id === 'installed' && (
            <ButtonLink href={INSTALL_URL} appearance="primary">
              Install Xomoni
            </ButtonLink>
          )}
          {todo?.id === 'account' && (
            <>
              <ButtonLink href={`/signup?next=${back}`} appearance="primary">
                Create a free account
              </ButtonLink>
              <ButtonLink href={`/login?next=${back}`}>Sign in</ButtonLink>
            </>
          )}
          {todo?.id === 'connected' && (
            <p className={s.todo}>
              Xomoni signs in with you by itself in this browser. If it hasn’t, open Xomoni and press{' '}
              <strong>Sign in to xomoni.com</strong> once.
            </p>
          )}
          {!todo && showDashboard && steps.every((step) => step.state === 'done') && (
            <ButtonLink href="/dashboard" appearance="primary">
              Open your dashboard
            </ButtonLink>
          )}
        </div>
      )}
    </section>
  );
}
