// The website's browser tests and the extension's, side by side (#404), run from apps/web by ci.yml's e2e and e2e-edge
// jobs. The two share nothing: the extension's need neither the site nor Supabase (ADR-0040), and each writes to its own
// folders. Run at once, they take the longer one's time rather than both: about 14 minutes instead of 25.
//
// Each line of output is streamed as it comes, after the name of its run, so a job that times out still shows where
// each run was. Exits 0 only when both runs pass.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

/** The two runs, from apps/web: the website's (playwright.config.ts) and the extension's. */
export const RUNS = [
  { label: 'website', command: 'npx', args: ['playwright', 'test'] },
  { label: 'extension', command: 'npx', args: ['playwright', 'test', '-c', 'playwright.extension.config.ts'] },
];

/**
 * Runs every `runs` entry at once, writing each line of its output to `out` after its label, padded so the lines
 * align. Resolves to 0 when every run exits 0, else to the first failing run's exit code (1 for a run ended by a
 * signal or that couldn't start), after a summary line per run.
 * @param {{ label: string, command: string, args: string[] }[]} runs
 * @param {{ write(text: string): unknown }} [out]
 * @returns {Promise<number>}
 */
export async function sideBySide(runs, out = process.stdout) {
  const width = Math.max(...runs.map((run) => run.label.length));
  const codes = await Promise.all(
    runs.map(
      ({ label, command, args }) =>
        new Promise((done) => {
          const prefix = `${label.padEnd(width)} │ `;
          const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
          const streams = [child.stdout, child.stderr].map((stream) => {
            const lines = createInterface({ input: stream, crlfDelay: Infinity });
            lines.on('line', (line) => out.write(`${prefix}${line}\n`));
            return new Promise((closed) => lines.on('close', closed));
          });
          let failedToStart = false;
          child.on('error', (error) => {
            failedToStart = true;
            out.write(`${prefix}could not start: ${error.message}\n`);
          });
          // 'close' comes once the process has exited and its output has ended; the lines are written by then.
          child.on('close', (code) => {
            void Promise.all(streams).then(() => done(failedToStart ? 1 : (code ?? 1)));
          });
        }),
    ),
  );
  runs.forEach(({ label }, i) => out.write(`${label}: ${codes[i] === 0 ? 'passed' : `failed (exit ${codes[i]})`}\n`));
  return codes.find((code) => code !== 0) ?? 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await sideBySide(RUNS);
