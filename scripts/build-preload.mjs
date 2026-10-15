import { build } from 'esbuild';
await build({ entryPoints: ['electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: 'dist-electron/electron/preload.cjs', target: 'node22' });
