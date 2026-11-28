// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router } from '@test/fakes/navigation';
import { browserProductDocs } from '../client/product-docs';
import { ADD_PROBLEM_MESSAGES } from '../domain/document';
import { ProductDocsManage } from './manage';

vi.mock('../client/product-docs', () => ({ browserProductDocs: { addVersion: vi.fn() } }));

const addVersion = vi.mocked(browserProductDocs.addVersion);

const versions = [
  { id: 2, slug: 'product', title: 'Brand engine v2', createdAt: '2026-11-28T10:00:00Z' },
  { id: 1, slug: 'product', title: 'Brand engine v1', createdAt: '2026-11-27T09:30:00Z' },
];

async function upload(title: string, html: string) {
  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), title);
  await userEvent.upload(screen.getByLabelText(/HTML file/), new File([html], 'doc.html', { type: 'text/html' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
}

describe('ProductDocsManage', () => {
  beforeEach(() => {
    resetNavigation();
    addVersion.mockReset();
  });

  it('lists the versions newest first, the first as current, each opening its own page', () => {
    render(<ProductDocsManage versions={versions} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    const current = screen.getByRole('row', { name: /Brand engine v2/ });
    const older = screen.getByRole('row', { name: /Brand engine v1/ });
    expect(current).toHaveTextContent('Brand engine v2 · current');
    expect(current).toHaveTextContent('28 Nov 2026, 10:00 UTC');
    expect(older).not.toHaveTextContent('current');
    expect(within(current).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/product/document');
    expect(within(older).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/product/document?v=1');
    const open = screen.getByRole('link', { name: 'Open the current version' });
    expect(open).toHaveAttribute('href', '/product/document');
    // The sandboxed document is a whole page of its own: it opens beside the console, not in place of it (#516).
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('target', '_blank');
  });

  it('says so when there is no version yet', () => {
    render(<ProductDocsManage versions={[]} />);
    expect(screen.getByText('No version yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('uploads the file as a new version, confirms it and refreshes the list', async () => {
    addVersion.mockResolvedValue({
      ok: true,
      version: { id: 3, slug: 'product', title: 'Brand engine v3', createdAt: '2026-11-28T12:00:00Z' },
    });
    render(<ProductDocsManage versions={versions} />);

    await upload('Brand engine v3', '<html><body>three</body></html>');

    expect(await screen.findByRole('status')).toHaveTextContent('Saved “Brand engine v3” as the current version.');
    expect(addVersion).toHaveBeenCalledWith({ title: 'Brand engine v3', html: '<html><body>three</body></html>' });
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it('shows why a version was refused, and refreshes nothing', async () => {
    addVersion.mockResolvedValue({ ok: false, problem: 'not-html' });
    render(<ProductDocsManage versions={versions} />);

    await upload('Notes', '# not a page');

    expect(await screen.findByRole('alert')).toHaveTextContent(ADD_PROBLEM_MESSAGES['not-html']);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
