import { describe, expect, it } from 'vitest';
import { UNKNOWN_PLATFORM } from './install-guide';
import { DEVELOPER_MODE_PLACES, INSTALL_HELP_ID, INSTALL_QUESTIONS, ownQuestion, questionHref } from './install-help';

describe('install questions (#306)', () => {
  it('each has its own anchor, safe in a link', () => {
    expect(new Set(INSTALL_QUESTIONS).size).toBe(INSTALL_QUESTIONS.length);
    for (const question of [...INSTALL_QUESTIONS, INSTALL_HELP_ID]) expect(question).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(INSTALL_QUESTIONS).not.toContain(INSTALL_HELP_ID);
  });

  it('starts with the ones that stop an install, and ends with where to ask', () => {
    expect(INSTALL_QUESTIONS.slice(0, 2)).toEqual(['developer-mode', 'wrong-folder']);
    expect(INSTALL_QUESTIONS.at(-1)).toBe('ask');
  });

  it('links to an answer on the same page, so the guide stays where it is', () => {
    expect(questionHref('developer-mode')).toBe('#developer-mode');
    expect(questionHref('not-recognized')).toBe('#not-recognized');
  });
});

describe('DEVELOPER_MODE_PLACES (#306)', () => {
  it('names Chrome, Edge and Brave, with their own extensions page and where the switch is', () => {
    expect(DEVELOPER_MODE_PLACES).toEqual([
      { browser: 'chrome', name: 'Chrome', address: 'chrome://extensions', where: 'at the top right' },
      { browser: 'edge', name: 'Edge', address: 'edge://extensions', where: 'in the panel on the left' },
      { browser: 'brave', name: 'Brave', address: 'brave://extensions', where: 'at the top right' },
    ]);
  });
});

describe('ownQuestion (#306)', () => {
  it('is which browsers run Xomoni, on a phone or tablet', () => {
    expect(ownQuestion({ browser: 'chrome', os: 'other', phone: true })).toBe('browsers');
    expect(ownQuestion({ browser: 'unsupported', os: 'mac', phone: true })).toBe('browsers');
  });

  it('is which browsers run Xomoni, in Firefox or Safari on a computer', () => {
    expect(ownQuestion({ browser: 'unsupported', os: 'windows', phone: false })).toBe('browsers');
  });

  it('is none in a browser that runs Xomoni, nor before the browser is known', () => {
    for (const browser of ['chrome', 'edge', 'brave', 'other'] as const)
      expect(ownQuestion({ browser, os: 'mac', phone: false })).toBeNull();
    expect(ownQuestion(UNKNOWN_PLATFORM)).toBeNull();
  });
});
