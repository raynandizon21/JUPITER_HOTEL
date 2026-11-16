import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Prints the backend + database status under Vite's "Local / Network" lines, and again whenever it changes:
 *   ➜  API:      http://localhost:4000  ✓ running
 *   ➜  Database: ✓ connected — jupiter_hotel @ localhost:3306
 */
function dbStatus(env: Record<string, string | undefined>): Plugin {
  const apiUrl = `http://localhost:${env.API_PORT || 4020}`;
  const db = `${env.DB_NAME || 'jupiter_hotel'} @ ${env.DB_HOST || 'localhost'}:${env.DB_PORT || 3306}`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  const check = async (): Promise<string[]> => {
    let api = false;
    let dbOk = false;
    let why = '';
    try {
      const res = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
      api = true;
      dbOk = res.ok;
      if (!res.ok) why = ((await res.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${res.status}`;
    } catch (e) {
      why = (e as Error).name === 'TimeoutError' ? 'API did not answer (database may be frozen)' : 'API not running — start it with `npm run dev:api` or use `npm run dev:all`';
    }
    return [
      `  ${green('➜')}  API:      ${apiUrl}  ${api ? green('✓ running') : red('✗ not running')}`,
      `  ${green('➜')}  Database: ${dbOk ? green('✓ connected') : red('✗ not connected')} ${dim(`— ${db}`)}${dbOk ? '' : `\n               ${dim(why || 'unknown error')}`}`,
    ];
  };

  return {
    name: 'jupiter-db-status',
    apply: 'serve',
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      let last = '';
      const report = async (always: boolean) => {
        const lines = (await check()).join('\n');
        if (always || lines !== last) console.log((always ? '' : '\n') + lines);
        last = lines;
      };
      server.printUrls = () => {
        printUrls();
        report(true);
      };
      const timer = setInterval(() => report(false), 15000); // tell when it connects / drops
      server.httpServer?.on('close', () => clearInterval(timer));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read .env here too (Vite doesn't put it in process.env), so the proxy uses the same API_PORT as the backend.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), tailwindcss(), dbStatus(env)],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // The app calls /api; in dev, forward it to the Node backend (server/index.js).
      proxy: { '/api': `http://localhost:${env.API_PORT || 4020}` },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
