// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import { ConsoleShell, selectedPage } from './console-shell';

const shell = () =>
  render(
    <ConsoleShell email="maintainer@example.com">
      <p>Page content</p>
    </ConsoleShell>,
  );

const sidebar = () => screen.getByRole('navigation', { name: 'Console' });

describe('ConsoleShell (#516)', () => {
  beforeEach(() => resetNavigation());

  it('names the console and the signed-in super-admin, with a way to sign out back to the console’s sign-in', () => {
    setLocation('/product');
    shell();
    expect(screen.getByText('Xomoni console')).toBeInTheDocument();
    expect(screen.getByText('maintainer@example.com')).toBeInTheDocument();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    const form = signOut.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/signout?next=%2Fproduct%2Flogin');
    expect(screen.getByRole('main')).toHaveTextContent('Page content');
  });

  it('lists the console’s pages in order, the document opening in a new tab', () => {
    setLocation('/product');
    shell();
    const links = within(sidebar()).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Overview', '/product'],
      ['Users', '/product/users'],
      ['Roadmap', '/product/roadmap'],
      ['Product document', '/product/document'],
      ['Versions', '/product/documents'],
      ['Audit log', '/product/audit'],
    ]);
    const document = within(sidebar()).getByRole('link', { name: /Product document/ });
    expect(document).toHaveAttribute('target', '_blank');
    expect(document).toHaveAccessibleName('Product document (opens in a new tab)');
  });

  it('marks the page being shown, an account’s page under Users', () => {
    setLocation('/product/users/u2');
    shell();
    expect(within(sidebar()).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar()).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'false');
  });

  it('follows a plain click with the router, and leaves a click with a key held to the browser', async () => {
    setLocation('/product');
    shell();
    await userEvent.click(within(sidebar()).getByRole('link', { name: 'Audit log' }));
    expect(router.push).toHaveBeenCalledWith('/product/audit');

    router.push.mockReset();
    const roadmap = within(sidebar()).getByRole('link', { name: 'Roadmap' });
    for (const keys of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(roadmap, keys);
    }
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the pages over the page from the menu button on a phone, and closes once one is chosen', async () => {
    setLocation('/product');
    shell();
    const menu = screen.getByRole('button', { name: 'Open the console menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menu);

    const drawer = await screen.findByRole('navigation', { name: 'Console menu' });
    expect(within(drawer).getByText('maintainer@example.com')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('link', { name: 'Users' }));
    expect(router.push).toHaveBeenCalledWith('/product/users');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Console menu' })).not.toBeInTheDocument());
  });
});

describe('selectedPage', () => {
  it('matches each page and the pages under it, and nothing for an unknown address', () => {
    expect(selectedPage('/product')).toBe('overview');
    expect(selectedPage('/product/users')).toBe('users');
    expect(selectedPage('/product/users/abc')).toBe('users');
    expect(selectedPage('/product/documents')).toBe('documents');
    expect(selectedPage('/product/document')).toBe('document');
    expect(selectedPage('/product/audit')).toBe('audit');
    expect(selectedPage('/product/elsewhere')).toBe('');
  });
});
