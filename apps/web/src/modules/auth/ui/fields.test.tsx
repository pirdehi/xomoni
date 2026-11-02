// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PASSWORD_REQUIREMENTS } from '../domain/credentials';
import { PasswordField, SubmitButton, TextField } from './fields';

/** The live checklist's items, as screen readers read them. */
function checklist() {
  const list = screen.getByRole('list', { name: 'Password requirements' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

describe('TextField', () => {
  it('labels the input and passes its attributes through', () => {
    render(<TextField label="Email" name="email" type="email" required />);

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('name', 'email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toBeRequired();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('ties a hint to the input', () => {
    render(<TextField label="Name" hint="Shown on your dashboard." />);

    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Shown on your dashboard.');
  });

  it('marks the input invalid and reads the error instead of the hint', () => {
    render(<TextField label="Email" hint="We never share it." error="Enter a valid email address" />);

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email address');
    expect(screen.queryByText('We never share it.')).not.toBeInTheDocument();
  });
});

describe('PasswordField', () => {
  it('hides the password until the person asks to see it', async () => {
    render(<PasswordField label="Password" name="password" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));

    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows no checklist without a policy', () => {
    render(<PasswordField label="Password" />);

    expect(screen.queryByRole('list', { name: 'Password requirements' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-describedby');
  });

  it('ticks the password rules off as the person types', async () => {
    render(<PasswordField label="New password" policy />);
    const input = screen.getByLabelText('New password');

    // Nothing typed yet: nothing is met, and the "too long" rule only shows up when it matters.
    expect(checklist()).toEqual([
      `${PASSWORD_REQUIREMENTS.too_short}(not met yet)`,
      `${PASSWORD_REQUIREMENTS.needs_letter}(not met yet)`,
      `${PASSWORD_REQUIREMENTS.needs_digit}(not met yet)`,
    ]);

    await userEvent.type(input, 'abc');
    expect(checklist()).toEqual([
      `${PASSWORD_REQUIREMENTS.too_short}(not met yet)`,
      `${PASSWORD_REQUIREMENTS.needs_letter}(met)`,
      `${PASSWORD_REQUIREMENTS.needs_digit}(not met yet)`,
    ]);

    await userEvent.type(input, 'defghij1');
    expect(checklist()).toEqual([
      `${PASSWORD_REQUIREMENTS.too_short}(met)`,
      `${PASSWORD_REQUIREMENTS.needs_letter}(met)`,
      `${PASSWORD_REQUIREMENTS.needs_digit}(met)`,
    ]);
    expect(input).toHaveAccessibleDescription(expect.stringContaining(PASSWORD_REQUIREMENTS.too_short));
  });

  it('adds the length limit once the password is too long', async () => {
    render(<PasswordField label="New password" policy />);

    await userEvent.click(screen.getByLabelText('New password'));
    await userEvent.paste(`a1${'x'.repeat(71)}`);

    expect(checklist()).toContain(`${PASSWORD_REQUIREMENTS.too_long}(not met yet)`);
  });

  it('reads both the error and the checklist to screen readers', () => {
    render(<PasswordField label="New password" policy error="Password needs: at least one number (0–9)" />);

    const input = screen.getByLabelText('New password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      expect.stringMatching(/^Password needs: at least one number \(0–9\) At least/),
    );
  });
});

describe('SubmitButton', () => {
  it('submits when idle', () => {
    render(<SubmitButton pending={false}>Save</SubmitButton>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toBeEnabled();
  });

  it('blocks a second submit while the first is pending', () => {
    render(<SubmitButton pending>Save</SubmitButton>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('can be held off by the form, for example until the captcha passes', () => {
    render(
      <SubmitButton pending={false} disabled>
        Save
      </SubmitButton>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
