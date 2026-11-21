// @vitest-environment happy-dom
import { act, render, screen, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ISSUES_URL, SECURITY_URL } from '@/shared/config/site';
import { type Platform, UNKNOWN_PLATFORM } from '../domain/install-guide';
import { INSTALL_HELP_ID, type InstallQuestionId, installQuestions } from '../domain/install-help';
import { NO_LISTINGS, type StoreListings } from '../domain/store-install';
import { usePlatform } from './install-guide';
import { InstallHelp, TroubleLinks } from './install-help';

const EDGE_WINDOWS: Platform = { browser: 'edge', os: 'windows', phone: false };
const CHROME_MAC: Platform = { browser: 'chrome', os: 'mac', phone: false };
const FIREFOX: Platform = { browser: 'unsupported', os: 'windows', phone: false };
const PHONE: Platform = { browser: 'unsupported', os: 'other', phone: true };

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgent');
  Reflect.deleteProperty(window.navigator, 'userAgentData');
});

const help = () => screen.getByRole('region', { name: 'Install help' });
/** One question's answer: the block its anchor names. */
const answer = (question: InstallQuestionId) => {
  const block = help().querySelector<HTMLElement>(`[id="${question}"]`);
  if (!block) throw new Error(`no answer for ${question}`);
  return block;
};

describe('InstallHelp (#306)', () => {
  it('is a section with its own heading and anchor, at the level below the page’s title', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    expect(help()).toHaveAttribute('id', INSTALL_HELP_ID);
    expect(within(help()).getByRole('heading', { level: 2, name: 'Install help' })).toBeInTheDocument();
  });

  it('lists every question first, each linking to its answer under a heading of its own', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const links = within(screen.getByRole('navigation', { name: 'Install questions' })).getAllByRole('link');
    // Before a store lists Xomoni, nothing about moving to it.
    const questions = installQuestions(false);
    expect(questions).not.toContain('move-to-store');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(questions.map((q) => `#${q}`));
    for (const [i, question] of questions.entries()) {
      const heading = within(answer(question)).getByRole('heading', { level: 3 });
      expect(heading).toHaveTextContent(links[i]!.textContent);
    }
    expect(within(help()).getAllByRole('heading', { level: 3 })).toHaveLength(questions.length);
  });

  it('says where Developer mode is in Chrome, Edge and Brave, marking no browser before it knows which', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const items = within(answer('developer-mode')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Chrome: chrome://extensions, at the top right.',
      'Edge: edge://extensions, in the panel on the left. No panel? Make the window wider, or open the menu at the top left of the page.',
      'Brave: brave://extensions, at the top right.',
    ]);
    expect(within(help()).queryByText('Your browser')).not.toBeInTheDocument();
    expect(within(help()).queryByText('Your device')).not.toBeInTheDocument();
  });

  it('marks the visitor’s own browser in Developer mode, and nothing else', () => {
    render(<InstallHelp platform={EDGE_WINDOWS} listings={NO_LISTINGS} />);

    const edge = within(answer('developer-mode')).getAllByRole('listitem')[1]!;
    expect(within(edge).getByText('Your browser')).toBeInTheDocument();
    expect(within(help()).getAllByText('Your browser')).toHaveLength(1);
  });

  it('in a browser that can’t run Xomoni, marks the answer about which browsers can', () => {
    render(<InstallHelp platform={FIREFOX} listings={NO_LISTINGS} />);

    const browsers = answer('browsers');
    expect(within(browsers).getByText('Your browser')).toBeInTheDocument();
    expect(browsers).toHaveTextContent('Firefox and Safari can’t run it');
    expect(within(answer('developer-mode')).queryByText('Your browser')).not.toBeInTheDocument();
  });

  it('on a phone, marks the answer that says phones and tablets can’t run Xomoni', () => {
    render(<InstallHelp platform={PHONE} listings={NO_LISTINGS} />);

    const browsers = answer('browsers');
    expect(within(browsers).getByText('Your device')).toBeInTheDocument();
    expect(browsers).toHaveTextContent('neither can phones or tablets, iPads included');
    expect(within(help()).queryByText('Your browser')).not.toBeInTheDocument();
  });

  it('marks nothing in Chrome but Chrome’s line', () => {
    render(<InstallHelp platform={CHROME_MAC} listings={NO_LISTINGS} />);

    expect(within(answer('browsers')).queryByText(/^Your/)).not.toBeInTheDocument();
    expect(
      within(within(answer('developer-mode')).getAllByRole('listitem')[0]!).getByText('Your browser'),
    ).toBeVisible();
  });

  it('says which folder to add: the unzipped one that holds manifest.json, unzipped on a Mac and on Windows', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const folder = answer('wrong-folder');
    expect(folder).toHaveTextContent('the one with manifest.json directly inside it');
    expect(folder).toHaveTextContent('Manifest file is missing or unreadable');
    expect(folder).toHaveTextContent('The browser can’t add the .zip file itself.');
    expect(folder).toHaveTextContent('On a Mac: Double-click xomoni-extension.zip');
    expect(folder).toHaveTextContent(
      'On Windows: Right-click xomoni-extension.zip in your Downloads folder, choose Extract All…',
    );
    expect(folder).toHaveTextContent('not Downloads, and not a folder inside xomoni-extension');
  });

  it('says a moved or deleted folder stops Xomoni, and how to bring it back on this browser’s extensions page', () => {
    render(<InstallHelp platform={EDGE_WINDOWS} listings={NO_LISTINGS} />);

    const off = answer('turned-off');
    expect(off).toHaveTextContent('If that folder was moved, renamed or deleted, Xomoni stops');
    expect(off).toHaveTextContent('Then open edge://extensions and press the reload button on Xomoni’s card.');
    expect(off).toHaveTextContent('Added from another place, it starts empty');
  });

  it('says the developer-mode warning is about every extension from a folder, and how to keep Xomoni', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const warning = answer('developer-mode-warning');
    expect(warning).toHaveTextContent('not about Xomoni in particular');
    expect(warning).toHaveTextContent('close the warning without turning extensions off');
    expect(warning).toHaveTextContent('turn its switch back on in chrome://extensions');
  });

  it('says how to update today without losing data, and that one-click updates and the stores are coming', () => {
    render(<InstallHelp platform={EDGE_WINDOWS} listings={NO_LISTINGS} />);

    const update = answer('update');
    expect(
      within(update)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Download the latest xomoni-extension.zip from the top of this page, and unzip it.',
      'Replace everything in your xomoni-extension folder with the new files. Keep the folder where it is.',
      'Open edge://extensions and press the reload button on Xomoni’s card.',
    ]);
    expect(update).toHaveTextContent('Your data stays: the browser keeps it, not the folder.');
    expect(update).toHaveTextContent('don’t remove Xomoni to update it, because removing it deletes its data');
    expect(update).toHaveTextContent('Coming soon: updating with one click from Xomoni');
    expect(update).toHaveTextContent('Chrome Web Store and Edge Add-ons');
    // Nothing on the page downloads but the download buttons and step.
    expect(within(help()).queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('says xomoni.com learns about Xomoni when Xomoni opens one of its pages, and how to make it', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const seen = answer('not-recognized');
    expect(seen).toHaveTextContent(
      'xomoni.com learns that Xomoni is in this browser when Xomoni opens one of its pages',
    );
    expect(seen).toHaveTextContent('In its account menu, press Sign in to xomoni.com.');
    expect(seen).toHaveTextContent('The Welcome page Xomoni opens when it is added does the same.');
    expect(seen).toHaveTextContent('Use the browser and profile where you added Xomoni.');
  });

  it('says the data stays in the browser, that removing Xomoni deletes it, and how to export it first', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const data = answer('your-data');
    expect(data).toHaveTextContent('inside the browser, on your computer');
    expect(data).toHaveTextContent('Removing Xomoni from the browser deletes all of it, for good.');
    expect(data).toHaveTextContent('Settings › Move your data › Export everything');
    expect(data).toHaveTextContent('Import from a file');
  });

  it('sends questions to GitHub issues, and security problems to the security policy', () => {
    render(<InstallHelp platform={UNKNOWN_PLATFORM} listings={NO_LISTINGS} />);

    const ask = answer('ask');
    expect(within(ask).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', ISSUES_URL);
    expect(within(ask).getByRole('link', { name: 'security policy' })).toHaveAttribute('href', SECURITY_URL);
    expect(ask).toHaveTextContent('Issues are public');
    expect(ask).toHaveTextContent('Xomoni never needs your X password.');
  });

  it('renders general words on the server, and marks the browser once hydrated, with no mismatch', async () => {
    function Help() {
      return <InstallHelp platform={usePlatform()} listings={NO_LISTINGS} />;
    }
    Object.defineProperty(window.navigator, 'userAgentData', {
      value: { brands: [{ brand: 'Microsoft Edge', version: '131' }], platform: 'Windows', mobile: false },
      configurable: true,
    });
    const html = renderToString(<Help />);
    expect(html).toContain('Where is Developer mode?');
    expect(html).not.toContain('Your browser');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <Help />, { onRecoverableError: (error) => errors.push(error) });
    });

    expect(errors).toEqual([]);
    expect(within(container).getByText('Your browser').closest('li')).toHaveTextContent(/^Edge/);
    expect(container).toHaveTextContent('Then open edge://extensions');
    container.remove();
  });
});

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const BOTH: StoreListings = { chrome: CHROME_STORE, edge: EDGE_STORE };
const CHROME_ONLY: StoreListings = { chrome: CHROME_STORE, edge: null };

describe('InstallHelp once a store lists Xomoni (#304)', () => {
  it('lists how to move from the zip to the store, after updating', () => {
    render(<InstallHelp platform={CHROME_MAC} listings={BOTH} />);

    const links = within(screen.getByRole('navigation', { name: 'Install questions' })).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(installQuestions(true).map((q) => `#${q}`));
    expect(within(answer('move-to-store')).getByRole('heading', { level: 3 })).toHaveTextContent(
      'How do I move from the zip to the store?',
    );
  });

  it('moves in four steps, export, remove, install, import, saying nothing moves by itself', () => {
    render(<InstallHelp platform={CHROME_MAC} listings={BOTH} />);

    const move = answer('move-to-store');
    const steps = within(move).getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('strong')?.textContent)).toEqual([
      'Export everything.',
      'Remove the zip copy.',
      'Install it from the store.',
      'Import the file.',
    ]);
    expect(steps[0]).toHaveTextContent('Settings › Move your data › Export everything');
    expect(steps[1]).toHaveTextContent('While no job runs, open chrome://extensions and press Remove on Xomoni.');
    expect(steps[1]).toHaveTextContent('The browser deletes its data, and your file keeps it.');
    // In Chrome, its own store only.
    expect(within(steps[2]!).getAllByRole('link')).toHaveLength(1);
    expect(within(steps[2]!).getByRole('link', { name: 'Xomoni in the Chrome Web Store' })).toHaveAttribute(
      'href',
      CHROME_STORE,
    );
    expect(steps[3]).toHaveTextContent('nothing is replaced with less or deleted');
    expect(move).toHaveTextContent('Nothing moves by itself.');
    expect(move).toHaveTextContent('the file never holds the connection');
  });

  it('sends Edge to its own store, and a browser no store serves to each store', () => {
    const { unmount } = render(<InstallHelp platform={EDGE_WINDOWS} listings={BOTH} />);
    expect(within(answer('move-to-store')).getByRole('link', { name: 'Xomoni in Edge Add-ons' })).toHaveAttribute(
      'href',
      EDGE_STORE,
    );
    expect(answer('move-to-store')).toHaveTextContent('open edge://extensions and press Remove');
    unmount();

    render(<InstallHelp platform={FIREFOX} listings={BOTH} />);
    const move = answer('move-to-store');
    expect(within(move).getByRole('link', { name: 'Xomoni in the Chrome Web Store' })).toHaveAttribute(
      'href',
      CHROME_STORE,
    );
    expect(within(move).getByRole('link', { name: 'Xomoni in Edge Add-ons' })).toHaveAttribute('href', EDGE_STORE);
    expect(move).toHaveTextContent('Xomoni from the Chrome Web Store or Edge Add-ons updates itself');
  });

  it('tells Edge to allow other stores when only the Chrome Web Store lists Xomoni', () => {
    render(<InstallHelp platform={EDGE_WINDOWS} listings={CHROME_ONLY} />);

    const move = answer('move-to-store');
    expect(within(move).getByRole('link', { name: 'Xomoni in the Chrome Web Store' })).toBeInTheDocument();
    expect(move).toHaveTextContent('(if Edge asks, allow extensions from other stores)');
  });

  it('names the store where updating and the developer-mode warning said it was coming, linking the move', () => {
    render(<InstallHelp platform={CHROME_MAC} listings={CHROME_ONLY} />);

    const update = answer('update');
    expect(update).not.toHaveTextContent('Coming soon');
    expect(update).toHaveTextContent('Installed from the Chrome Web Store, Xomoni updates itself.');
    expect(within(update).getByRole('link', { name: 'How do I move from the zip to the store?' })).toHaveAttribute(
      'href',
      '#move-to-store',
    );
    const warning = answer('developer-mode-warning');
    expect(warning).toHaveTextContent('Installed from the Chrome Web Store, it needs no developer mode');
    expect(within(warning).getByRole('link', { name: 'How do I move from the zip to the store?' })).toBeInTheDocument();
  });

  it('marks the visitor’s phone as before', () => {
    render(<InstallHelp platform={PHONE} listings={BOTH} />);

    expect(within(answer('browsers')).getByText('Your device')).toBeInTheDocument();
  });
});

describe('TroubleLinks (#306)', () => {
  it('links each question to its answer on the same page', () => {
    render(<TroubleLinks questions={['developer-mode', 'wrong-folder']} />);

    expect(screen.getByText(/^Trouble\?/)).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Where is Developer mode?', '#developer-mode'],
      ['Which folder do I add?', '#wrong-folder'],
    ]);
  });
});
