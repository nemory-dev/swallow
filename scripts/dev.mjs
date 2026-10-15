import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { randomUUID } from 'node:crypto';
import { waitForDevServer } from './dev-server.mjs';
function command(name, args, options = {}) { return spawn(name, args, { stdio: 'inherit', ...options }); }
const build = command('npm', ['run', 'build']);
const code = await new Promise(resolve => build.once('exit', resolve));
if (code !== 0) process.exit(code ?? 1);
const nonce = randomUUID();
const vite = command(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { env: { ...process.env, SWALLOW_DEV_TOKEN: nonce } });
let electron;
vite.once('exit', () => electron?.kill('SIGTERM'));
function stop() { electron?.kill('SIGTERM'); vite.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  await waitForDevServer(vite, 'http://127.0.0.1:5173', nonce);
  electron = command(electronPath, ['.'], { env: { ...process.env, SWALLOW_DEV_URL: 'http://127.0.0.1:5173' } });
  const electronCode = await new Promise(resolve => electron.once('exit', resolve));
  stop(); process.exitCode = electronCode ?? 1;
} catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
