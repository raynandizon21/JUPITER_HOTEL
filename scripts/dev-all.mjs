// Local development: runs the Node backend (server/index.js, restarts on change) and the Vite
// dev server together in one terminal. Ctrl+C stops both.
//
// Usage:  npm run dev:all
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const node = process.execPath;
const envArgs = existsSync('.env') ? ['--env-file=.env'] : [];

const procs = [
  ['api', [...envArgs, '--watch-path=server', 'server/index.js']],
  ['web', ['node_modules/vite/bin/vite.js', '--port=3000', '--host=0.0.0.0']],
].map(([name, args]) => {
  const p = spawn(node, args, { stdio: 'inherit' });
  p.on('exit', (code) => {
    if (code) console.log(`[${name}] exited with code ${code}`);
  });
  return p;
});

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
