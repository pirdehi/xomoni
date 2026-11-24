// The strict check of a digest file (#430, ADR-0046): the exact shape of version 1, read from `unknown`. Everything in a
// digest but the summary comes from a repository Xomoni doesn't control, so no page shows a file this refuses. Only the
// server reads files (`server/digests.ts`); the pages get checked digests. Pure.
import { z } from 'zod';
import { AREAS, DIGEST_LIMITS, DIGEST_REPO } from './digest';

// Before any schema is built: zod otherwise probes `new Function`, which the site's Content-Security-Policy blocks and
// reports (ADR-0014). Interpreted parsing is fast enough for a few small files.
z.config({ jitless: true });

/** Whether a character may never appear in text from X's repository: control, zero-width and direction characters. */
function unsafe(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** One line of untrusted text as the tool cleans it: not empty, at most 200 characters, no unsafe character. */
const cleanLine = z
  .string()
  .min(1)
  .refine((text) => Array.from(text).length <= DIGEST_LIMITS.text, 'longer than 200 characters')
  .refine((text) => !Array.from(text).some(unsafe), 'holds a control or direction character')
  .refine((text) => text === text.trim(), 'starts or ends with a space');

/** A full commit id. */
const commit = z.string().regex(/^[0-9a-f]{40}$/, 'not a full commit id');

/** One area a digest's range touched. */
const areaEntry = z.strictObject({
  area: z.enum(AREAS),
  files: z.number().int().min(1),
  paths: z.array(cleanLine).max(DIGEST_LIMITS.paths),
});

/** The shape of a digest file, version 1: no field outside it is accepted. */
const digestSchema = z
  .strictObject({
    version: z.literal(1),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'not yyyy-mm'),
    repo: z.literal(DIGEST_REPO),
    from: commit,
    to: commit,
    toDate: z.iso.date(),
    status: z.enum(['draft', 'published']),
    summary: z
      .string()
      .refine((text) => Array.from(text).length <= DIGEST_LIMITS.summary, 'longer than 2,000 characters')
      .refine((text) => !Array.from(text).some((char) => char !== '\n' && unsafe(char)), 'holds a control character'),
    commits: z.number().int().min(1),
    files: z.number().int().min(0),
    filesCapped: z.boolean(),
    areas: z.array(areaEntry).refine((areas) => new Set(areas.map((a) => a.area)).size === areas.length, 'repeated'),
    parameters: z
      .array(z.string().regex(/^[A-Za-z][\w.-]{1,79}$/, 'not a parameter name'))
      .max(DIGEST_LIMITS.parameters),
    parameterCount: z.number().int().min(0),
    messages: z.array(cleanLine).max(DIGEST_LIMITS.messages),
  })
  .refine((d) => d.from !== d.to, { message: 'from and to are the same commit', path: ['to'] })
  .refine((d) => d.parameterCount >= d.parameters.length, { message: 'fewer than its names', path: ['parameterCount'] })
  .refine((d) => d.status === 'draft' || d.summary.trim() !== '', {
    message: 'a published digest has no summary',
    path: ['summary'],
  });

/** A digest that passed the check. */
export type Digest = z.infer<typeof digestSchema>;

/** One area of a digest. */
export type DigestArea = Digest['areas'][number];

/** A digest file read: the digest, or what is wrong with it, field by field. */
export type DigestRead = { ok: true; digest: Digest } | { ok: false; problems: string[] };

/**
 * Reads a digest file's contents, which are untrusted: the exact shape of version 1, every commit id full, every line
 * of outside text clean and within its limit, and a summary on every published digest.
 */
export function parseDigest(value: unknown): DigestRead {
  const result = digestSchema.safeParse(value);
  if (result.success) return { ok: true, digest: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => `${issue.path.join('.') || 'digest'}: ${issue.message}`),
  };
}
