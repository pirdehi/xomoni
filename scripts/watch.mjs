import { spawn } from 'node:child_process';

// Vite empties dist/ on its first build, so start the content-script watcher
// only after that first pass has finished.
const vite = spawn('npx', ['vite', 'build', '--watch'], { stdio: ['inherit', 'pipe', 'inherit'] });
let started = false;
vite.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (!started && /built in/.test(String(chunk))) {
    started = true;
    spawn('node', ['scripts/build-content.mjs', '--watch'], { stdio: 'inherit' });
  }
});
