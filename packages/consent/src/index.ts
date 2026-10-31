/**
 * The informed-consent text (#24, PLAYBOOK C7): what a person must know before Xomoni acts on an X account.
 * One source for the extension's consent dialog, the xomoni.com/risks page and the README, so they can't
 * drift apart.
 */

/** Version of the text. Raise it when the substance changes: every X account is then asked again. */
export const CONSENT_VERSION = 2;

/** What the person types to give consent, exactly. */
export const CONSENT_PHRASE = 'I UNDERSTAND';

/** X's automation rules, which prohibit non-API automation such as scripting the website. */
export const X_AUTOMATION_RULES_URL = 'https://help.x.com/en/rules-and-policies/x-automation';

/** Heading of the consent text. */
export const CONSENT_TITLE = 'Before you start: the risks';

/** The opening paragraph. */
export const CONSENT_INTRO =
  'Xomoni deletes posts, replies, reposts and likes on your X account by clicking X’s own buttons in a normal browser tab. Read this once for each X account, before its first job.';

/** One part of the consent text: a bold lead, a paragraph or a list, and an optional link. */
export interface ConsentSection {
  title: string;
  text?: string;
  points?: readonly string[];
  link?: { label: string; href: string };
}

/** The parts of the consent text, in order. */
export const CONSENT_SECTIONS: readonly ConsentSection[] = [
  {
    title: 'X’s rules forbid this kind of automation',
    text: 'X prohibits non-API automation, such as scripting the X website. X can limit, lock or suspend an account that breaks its rules.',
    link: { label: 'Read X’s automation rules', href: X_AUTOMATION_RULES_URL },
  },
  {
    title: 'The risk can’t be removed',
    text: 'Xomoni keeps the risk low: it never uses more than one fifth of any limit X announces, starts slower than that, and stops at X’s first warning. It can’t make the risk zero. Only X decides what happens to your account.',
  },
  {
    title: 'A research project, at your own risk',
    text: 'Xomoni is open-source research into ways to clean up your own X account through X’s website. It comes with no guarantee that X won’t limit, lock or suspend your account. You use it at your own risk, and the consequences for your X account are yours.',
  },
  {
    title: 'Deletions are permanent',
    text: 'A deleted post, an undone repost or a removed like can’t be brought back, by Xomoni or by X.',
  },
  {
    title: 'Download your archive first',
    text: 'Before you delete anything, request your X archive (on X: Settings, Your account, Download an archive of your data). It is your only copy, and Xomoni can read it to find your oldest posts.',
  },
  {
    title: 'What Xomoni never does',
    points: [
      'Ask for, store or read your X password or cookies.',
      'Send your posts, likes or anything else from X to any server.',
      'Forge requests, solve captchas, use proxies or hide that it is automation.',
      'Use more than one fifth of any limit X announces.',
      'Start, resume or approve deletions from the website.',
    ],
  },
];

/** The closing sentence: what giving consent means. */
export const CONSENT_DECISION =
  'If you go ahead, you do so for this X account, knowing these risks and accepting them as your own.';

/** The consent text as Markdown, for the README (between its `consent` markers). */
export function consentMarkdown(): string {
  const parts = [CONSENT_INTRO];
  for (const { title, text, points, link } of CONSENT_SECTIONS) {
    const lead = [`**${title}.**`, text, link ? `[${link.label}](${link.href}).` : ''].filter(Boolean).join(' ');
    parts.push(points ? `${lead}\n\n${points.map((p) => `- ${p}`).join('\n')}` : lead);
  }
  parts.push(CONSENT_DECISION);
  return parts.join('\n\n');
}
