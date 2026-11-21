// Bundles the two scripts that run in x.com's tab as classic scripts, beside the Vite build:
//
//   node scripts/build-content.mjs [--watch] [--outdir <folder>]
//
// `--outdir` (dist by default) builds a copy elsewhere: the browser tests build theirs in a folder of their own
// (`vite build --outDir <folder>` first), so they never rewrite a dist someone has loaded in Chrome (#342).
import { parseArgs } from 'node:util';
import { build, context } from 'esbuild';

const { values } = parseArgs({
  options: { watch: { type: 'boolean', default: false }, outdir: { type: 'string', default: 'dist' } },
});

const options = {
  entryPoints: {
    inject: 'src/inject/interceptor.ts',
    content: 'src/content/content.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  outdir: values.outdir,
  logLevel: 'info',
};

if (values.watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
