import { writeFileSync } from 'node:fs';
import { processPdf, PdfFailure } from './runtime.mjs';

// fd 3 is reserved for the app-owned result frame. Library stdout is never parsed.
function finish(frame, status) {
  try { writeFileSync(3, JSON.stringify(frame)); }
  catch { status = 1; }
  process.exit(status);
}
let frame, status = 0;
try {
  let args = process.argv.slice(2);
  if (args[0] === '--parent-pid') {
    const parent = Number(args[1]);
    if (!Number.isInteger(parent) || parent <= 0 || parent > 2_147_483_647) throw new PdfFailure('request');
    args = args.slice(2);
    const checkParent = () => {
      try { process.kill(parent, 0); }
      catch { finish({ ok: false, error: 'cancelled' }, 1); }
    };
    checkParent();
    setInterval(checkParent, 200).unref();
  }
  if ((args[0] === 'inspect' && args.length !== 2) || (args[0] === 'render' && args.length !== 3)) throw new PdfFailure('request');
  const value = await processPdf(args[0], args[1], args[2] === undefined ? undefined : Number(args[2]));
  frame = { ok: true, value };
} catch (error) { status = 1; frame = { ok: false, error: error instanceof PdfFailure ? error.code : 'invalid' }; }
// Also terminates OCR threads after initialization failure; no child work outlives this request.
finish(frame, status);
