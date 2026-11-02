// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FakeTurnstile from '@test/fakes/turnstile';
import { TEST_TOKEN, resetTurnstile, turnstile } from '@test/fakes/turnstile';
import { CaptchaStatus, useCaptcha } from './captcha';

type WidgetProps = Parameters<typeof FakeTurnstile.Turnstile>[0];

/** The props the hook last gave the widget, to fire the callbacks the shared fake never calls (expiry, after a click). */
const widget = vi.hoisted(() => ({ props: undefined as WidgetProps | undefined }));

vi.mock('@marsidev/react-turnstile', async (importOriginal) => {
  const fake = await importOriginal<typeof FakeTurnstile>();
  return {
    ...fake,
    Turnstile: (props: WidgetProps) => {
      widget.props = props;
      return fake.Turnstile(props);
    },
  };
});

/** A form's use of the hook: the widget, the status line, and what the form reads from it. */
function Harness() {
  const captcha = useCaptcha('test');
  return (
    <div>
      {captcha.widget}
      <output aria-label="Token">{captcha.token ?? 'none'}</output>
      <button type="button" onClick={captcha.reset}>
        Submitted
      </button>
      <CaptchaStatus captcha={captcha} />
    </div>
  );
}

const token = () => screen.getByRole('status', { name: 'Token' }).textContent;

/** Moves fake time forward and lets React apply what the timers did. */
function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useCaptcha and CaptchaStatus', () => {
  beforeEach(() => {
    resetTurnstile();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands out the token and says nothing once the check passes', () => {
    render(<Harness />);

    expect(token()).toBe(TEST_TOKEN);
    expect(screen.queryByText(/security check/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('gets a fresh token after a submit, because tokens are single-use', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Submitted' }));

    expect(turnstile.resets).toBe(1);
    expect(token()).toBe(TEST_TOKEN);
  });

  it('drops the used token while the new check runs', async () => {
    render(<Harness />);
    turnstile.outcome = 'silent';

    await userEvent.click(screen.getByRole('button', { name: 'Submitted' }));

    expect(token()).toBe('none');
    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();
  });

  it('says the check is running while it runs', () => {
    turnstile.outcome = 'silent';
    render(<Harness />);

    expect(token()).toBe('none');
    expect(screen.getByText('Running a quick security check…')).toHaveAttribute('role', 'status');
  });

  it('asks the person to tick the box when Cloudflare wants a click, and never calls that stuck', () => {
    vi.useFakeTimers();
    turnstile.outcome = 'interactive';
    render(<Harness />);

    expect(screen.getByText('Tick the box above to continue.')).toBeInTheDocument();

    wait(60_000);

    expect(screen.getByText('Tick the box above to continue.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a retry when the check fails', () => {
    turnstile.outcome = 'error';
    render(<Harness />);

    expect(token()).toBe('none');
    expect(screen.getByRole('alert')).toHaveTextContent('The security check didn’t finish. Check your connection');
    expect(screen.getByRole('button', { name: 'try again' })).toBeInTheDocument();
  });

  it('offers a retry when the check takes longer than 20 seconds', () => {
    vi.useFakeTimers();
    turnstile.outcome = 'silent';
    render(<Harness />);

    wait(19_999);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    wait(1);
    expect(screen.getByRole('alert')).toHaveTextContent('The security check didn’t finish.');
  });

  it('restarts the widget on retry when Cloudflare’s script is loaded, and waits another 20 seconds', () => {
    vi.useFakeTimers();
    vi.stubGlobal('turnstile', {});
    turnstile.outcome = 'silent';
    render(<Harness />);
    wait(20_000);

    fireEvent.click(screen.getByRole('button', { name: 'try again' }));

    expect(turnstile.resets).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();

    wait(20_000);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('gets a token when the retried check passes', () => {
    vi.stubGlobal('turnstile', {});
    turnstile.outcome = 'error';
    render(<Harness />);
    turnstile.outcome = 'success';

    fireEvent.click(screen.getByRole('button', { name: 'try again' }));

    expect(token()).toBe(TEST_TOKEN);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops an expired token and runs the check again, so a form left open cannot submit it', () => {
    vi.useFakeTimers();
    render(<Harness />);
    expect(token()).toBe(TEST_TOKEN);
    // Cloudflare renews the token in the background; until it answers, there is none.
    turnstile.outcome = 'silent';

    act(() => widget.props!.onExpire!());

    expect(token()).toBe('none');
    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();
    // If no new token arrives, the person is offered a retry as usual.
    wait(20_000);
    expect(screen.getByRole('alert')).toHaveTextContent('The security check didn’t finish.');
  });

  it('goes back to a running check once the person ticked Cloudflare’s box', () => {
    turnstile.outcome = 'interactive';
    render(<Harness />);
    expect(screen.getByText('Tick the box above to continue.')).toBeInTheDocument();
    // The person ticked the box; Cloudflare has not answered yet.
    turnstile.outcome = 'silent';

    act(() => widget.props!.onAfterInteractive!());

    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();
    act(() => widget.props!.onSuccess!(TEST_TOKEN));
    expect(token()).toBe(TEST_TOKEN);
    expect(screen.queryByText(/security check|Tick the box/)).not.toBeInTheDocument();
  });

  it('reloads the page on retry when Cloudflare’s script never loaded', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
    turnstile.outcome = 'error';
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'try again' }));

    expect(reload).toHaveBeenCalledOnce();
    expect(turnstile.resets).toBe(0);
  });
});
