import { build, context } from 'esbuild';

const options = {
  entryPoints: {
    inject: 'src/inject/interceptor.ts',
    content: 'src/content/content.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  outdir: 'dist',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
