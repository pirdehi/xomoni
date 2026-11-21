// Fake command-line tools for the tooling tests (#343): a `gh` or `curl` that answers from rules and logs every call,
// so a test can run a script as the workflow does, with no network and no GitHub. Used by tooling/nightly.test.mjs and
// tooling/published-release.test.mjs.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * What every fake runs, in CommonJS since the fakes have no extension. It logs the call, then follows the first rule
 * for its name whose `args` start the call's arguments and, if given, whose `has` is in one of them. A rule can write
 * `files` into the folder after `--dir`, write `output` to the file after `--output`, print `stdout` and `stderr`, and
 * end with `status`. A call no rule answers fails with status 2.
 */
const FAKE = `
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const dir = process.env.FAKE_DIR;
const call = { name, args, token: process.env.GH_TOKEN ?? null, repo: process.env.GH_REPO ?? null };
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(call) + '\\n');
const rules = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8'))[name] ?? [];
const rule = rules.find(
  (r) => r.args.every((arg, i) => arg === args[i]) && (r.has == null || args.some((arg) => arg.includes(r.has))),
);
if (!rule) {
  process.stderr.write('fake ' + name + ': no rule for ' + args.join(' ') + '\\n');
  process.exit(2);
}
const after = (flag) => args[args.indexOf(flag) + 1];
if (rule.files) {
  mkdirSync(after('--dir'), { recursive: true });
  for (const [file, content] of Object.entries(rule.files)) writeFileSync(join(after('--dir'), file), content);
}
if (rule.output != null) writeFileSync(after('--output'), rule.output);
if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exit(rule.status ?? 0);
`;

/**
 * Makes a folder with fake `names` (such as `gh` and `curl`) in its `bin`, answering from `rules` (by name, a list of
 * rules as `FAKE` reads them). Returns the `env` to run a script with, which puts the fakes first on PATH; `calls()`,
 * every call so far with its arguments and the GH_TOKEN and GH_REPO it saw; and `cleanup()`.
 */
export function fakeCommands(names, rules) {
  const dir = mkdtempSync(join(tmpdir(), 'xomoni-fakes-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(rules));
  writeFileSync(join(dir, 'calls.jsonl'), '');
  for (const name of names) writeFileSync(join(dir, 'bin', name), `#!${process.execPath}\n${FAKE}`, { mode: 0o755 });
  return {
    dir,
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_DIR: dir },
    calls: () =>
      readFileSync(join(dir, 'calls.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
