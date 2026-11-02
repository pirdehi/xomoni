// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { CallbackError, GoogleButton } from './google-button';

vi.mock('../client/auth', () => ({
  browserAuth: { startGoogleSignIn: vi.fn() },
}));

const startGoogle = vi.mocked(browserAuth.startGoogleSignIn);
type StartResult = Awaited<ReturnType<typeof browserAuth.startGoogleSignIn>>;

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';

describe('GoogleButton', () => {
  let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;

  beforeEach(() => {
    resetNavigation();
    startGoogle.mockReset();
    assign = vi.fn<(url: string | URL) => void>();
    vi.spyOn(window.location, 'assign').mockImplementation(assign);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens Google and keeps where the person was headed for the return trip', async () => {
    setLocation('/login', 'next=/account');
    startGoogle.mockResolvedValue({ ok: true, url: GOOGLE_URL });
    render(<GoogleButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(startGoogle).toHaveBeenCalledWith('/account');
    expect(assign).toHaveBeenCalledWith(GOOGLE_URL);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passes no destination when the page has none', async () => {
    startGoogle.mockResolvedValue({ ok: true, url: GOOGLE_URL });
    render(<GoogleButton label="Sign up with Google" />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }));

    expect(startGoogle).toHaveBeenCalledWith(null);
  });

  it('blocks a second click while Google sign-in starts', async () => {
    let finish: (result: StartResult) => void = () => undefined;
    startGoogle.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<GoogleButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    await act(async () => finish({ ok: true, url: GOOGLE_URL }));
    expect(assign).toHaveBeenCalledWith(GOOGLE_URL);
  });

  it('says why Google sign-in could not start, and lets the person try again', async () => {
    startGoogle.mockResolvedValueOnce({ ok: false, code: 'provider_error' });
    startGoogle.mockResolvedValueOnce({ ok: true, url: GOOGLE_URL });
    render(<GoogleButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.provider_error);
    expect(assign).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith(GOOGLE_URL);
  });
});

describe('CallbackError', () => {
  beforeEach(() => {
    resetNavigation();
  });

  it('shows the error the callback passed back', () => {
    setLocation('/login', `error=${encodeURIComponent(AUTH_ERROR_MESSAGES.provider_error)}`);
    render(<CallbackError />);

    expect(screen.getByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.provider_error);
  });

  it('shows nothing without an error', () => {
    setLocation('/login');
    const { container } = render(<CallbackError />);

    expect(container).toBeEmptyDOMElement();
  });
});
