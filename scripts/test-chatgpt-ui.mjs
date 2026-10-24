import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
const { _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const packagedApp = process.argv[2];
if (packagedApp) assert.ok(isAbsolute(packagedApp) && (packagedApp.endsWith('.app') || /[\\/]Swallow\.exe$/i.test(packagedApp)));
const executablePath = packagedApp ? (packagedApp.endsWith('.app') ? join(packagedApp, 'Contents/MacOS/Swallow') : packagedApp) : (await import('electron')).default;
const data = process.env.SWALLOW_TEST_OUTPUT || await mkdtemp(join(tmpdir(), 'swallow-chatgpt-ui-'));
assert.ok(isAbsolute(data)); await mkdir(data, { recursive: true });
const screenshots = join(data, 'screenshots'); await mkdir(screenshots);
const errors = [];
let app;
async function launch() {
  const env = { ...process.env, SWALLOW_DATA_DIR: data }; delete env.SWALLOW_DEV_URL; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: packagedApp ? [] : ['.'], cwd: packagedApp ? dirname(executablePath) : root, env, timeout: 30000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.swallow?.getState().then(state => !!state.language));
  await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'ko' }));
  // Only this test process intercepts the transport and browser. Production code has no mock flag.
  await app.evaluate(async ({ shell, app }) => {
    const root = app.getAppPath();
    const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
    const { generateKeyPairSync } = require('node:crypto');
    const { SignJWT } = require('jose');
    const { ChatGPTTransport } = require(root + '/dist-electron/electron/chatgpt-auth.js');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const calls = []; let authorize;
    globalThis.swallowChatGPTTest = { calls, wait: true, deny: false, modelStatus: 200, usage: [] };
    shell.openExternal = async raw => {
      const url = new URL(raw);
      if (url.href === 'https://chatgpt.com/settings/usage') { globalThis.swallowChatGPTTest.usage.push(raw); return; }
      if (url.origin !== 'https://auth.openai.com') throw new Error('Unexpected external URL');
      authorize = url;
      if (globalThis.swallowChatGPTTest.wait) return;
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('client_id', 'oaiapp_ui_fixture');
      if (globalThis.swallowChatGPTTest.deny) callback.searchParams.set('error', 'access_denied');
      else callback.searchParams.set('code', 'UI_CODE');
      await fetch(callback);
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    ChatGPTTransport.prototype.request = async function (url, init = {}) {
      calls.push({ url, body: String(init.body ?? '') });
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
      if (url.endsWith('/jwks')) return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'ui', alg: 'RS256' }] });
      if (url.endsWith('/oauth/token')) {
        const id = await new SignJWT({ email: 'ui@example.invalid', nonce: authorize.searchParams.get('nonce') }).setProtectedHeader({ alg: 'RS256', kid: 'ui' }).setIssuer('https://auth.openai.com').setAudience('oaiapp_ui_fixture').setSubject('ui-sub').setIssuedAt().setExpirationTime('1h').sign(privateKey);
        return json({ access_token: 'UI_ACCESS_SECRET', refresh_token: 'UI_REFRESH_SECRET', id_token: id, token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' });
      }
      if (url.endsWith('/models')) return globalThis.swallowChatGPTTest.modelStatus === 200
        ? json({ models: [{ slug: 'ui-model', display_name: 'UI Model', visibility: 'list' }] })
        : json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'UI_PRIVATE_DETAIL' } }, 429);
      if (url.endsWith('/responses')) {
        const body = JSON.parse(init.body), payload = JSON.parse(body.input.find(item => item.role === 'user').content);
        const result = body.text?.format.schema.properties.verdict
          ? { reason: 'Synthetic quality check', verdict: 'pass' }
          : { overview: 'ChatGPT 합성 응답으로 연결 흐름을 확인합니다.', keyPoints: [{ title: '원문 근거', explanation: '자료에서 확인한 내용을 살펴보세요.', quote: payload.source.slice(0, 25) }], question: '어떤 내용을 배웠나요?' };
        const events = [{ type: 'response.output_text.delta', delta: JSON.stringify(result) }, { type: 'response.completed', response: { status: 'completed' } }];
        return new Response(new TextEncoder().encode(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')));
      }
      if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
      throw new Error('Unexpected transport URL');
    };
  });
  return page;
}
try {
  let page = await launch();
  await page.locator('.account-toggle').click();
  assert.equal(await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).isEnabled(), false);
  await page.waitForFunction(() => { const img = document.querySelector('.chatgpt-sign-in img'); return img?.complete && img.naturalWidth > 0; });
  assert.ok((await page.locator('.chatgpt-sign-in').boundingBox()).width > 250);
  assert.match(await page.locator('.chatgpt-risk').innerText(), /계정.*정지/);
  assert.equal(await page.getByRole('button', { name: /Gemini|Claude/ }).count(), 0);
  await page.locator('.chatgpt-settings details').evaluate(element => { element.open = true; });
  await page.screenshot({ path: join(screenshots, 'connection-disclosure.png'), fullPage: true });
  await page.locator('.chatgpt-consent input').check();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('button', { name: '로그인 취소', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.chatgpt.status !== 'checking'));
  assert.equal((await app.evaluate(() => globalThis.swallowChatGPTTest.calls)).length, 0);
  await app.evaluate(() => { globalThis.swallowChatGPTTest.wait = false; globalThis.swallowChatGPTTest.deny = true; });
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.chatgpt.error === 'public.chatgptCancelled'));
  assert.equal((await app.evaluate(() => globalThis.swallowChatGPTTest.calls)).length, 0);
  await app.evaluate(() => { globalThis.swallowChatGPTTest.deny = false; });
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('dialog', { name: 'ChatGPT 구독을 사용합니다', exact: true }).waitFor();
  await page.screenshot({ path: join(screenshots, 'first-use.png'), fullPage: true });
  await page.getByRole('button', { name: '확인했어요', exact: true }).click();
  await page.getByRole('button', { name: '연결 패널 닫기', exact: true }).click();
  await page.getByRole('button', { name: '짧은 예제 문서로 시작하기 →', exact: true }).click();
  await page.locator('.study-model-settings > summary').click();
  const state = await page.evaluate(() => window.swallow.getState());
  const slug = state.models.find(model => model.providerId === 'chatgpt').slug;
  await page.getByRole('combobox', { name: '학습 모델', exact: true }).selectOption(slug);
  await page.locator('.study-model-settings > summary').click();
  assert.match(await page.locator('.chatgpt-usage').innerText(), /ChatGPT 구독 사용/);
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.getByRole('button', { name: '짧게 설명해줘', exact: true }).click();
  await page.getByText('ChatGPT 합성 응답으로 연결 흐름을 확인합니다.', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshots, 'study-response.png'), fullPage: true });
  const requests = (await app.evaluate(() => globalThis.swallowChatGPTTest.calls)).filter(call => call.url.endsWith('/responses'));
  assert.equal(requests.length, 2);
  for (const request of requests) { const body = JSON.parse(request.body); assert.equal(body.store, false); assert.equal(body.stream, true); }
  assert.doesNotMatch((await readFile(join(data, 'subscription-v1/credentials.enc'))).toString(), /UI_ACCESS_SECRET|UI_REFRESH_SECRET|ui@example/);
  assert.equal(await app.evaluate(async ({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable()), true);
  assert.doesNotMatch(JSON.stringify(await page.evaluate(() => window.swallow.getState())), /UI_ACCESS_SECRET|UI_REFRESH_SECRET|UI_PRIVATE_DETAIL/);
  await app.close(); app = undefined;
  page = await launch();
  assert.equal((await app.evaluate(() => globalThis.swallowChatGPTTest.calls)).length, 0);
  const restored = await page.evaluate(async () => {
    const state = await window.swallow.getState();
    return window.swallow.getStudyWorkspace(state.library.activeDocumentId);
  });
  assert.equal(restored.session.guide.overview, 'ChatGPT 합성 응답으로 연결 흐름을 확인합니다.');
  await page.locator('.account-toggle').click();
  await page.getByRole('button', { name: 'ChatGPT 모델 확인', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.chatgpt.status === 'ready'));
  assert.equal(await page.getByRole('dialog', { name: 'ChatGPT 구독을 사용합니다', exact: true }).isVisible(), false);
  await page.locator('.chatgpt-settings').getByRole('button', { name: '사용량 관리', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.swallowChatGPTTest.usage), ['https://chatgpt.com/settings/usage']);
  await app.evaluate(() => { globalThis.swallowChatGPTTest.modelStatus = 429; });
  await page.getByRole('button', { name: 'ChatGPT 모델 확인', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.chatgpt.error === 'public.chatgptLimit'));
  assert.doesNotMatch(await page.locator('body').innerText(), /UI_PRIVATE_DETAIL|UI_ACCESS_SECRET|UI_REFRESH_SECRET/);
  await app.evaluate(() => { globalThis.swallowChatGPTTest.modelStatus = 200; });
  await page.getByRole('button', { name: 'ChatGPT 모델 확인', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.chatgpt.status === 'ready'));
  await page.getByRole('button', { name: 'ChatGPT 연결 해제', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.chatgpt.status === 'disconnected'));
  assert.equal((await page.evaluate(() => window.swallow.getState())).chatgpt.accounts[0].connected, false);
  assert.equal((await app.evaluate(() => globalThis.swallowChatGPTTest.calls)).filter(call => call.url.endsWith('/revoke')).length, 1);
  assert.equal(await app.evaluate(async ({ app, safeStorage }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const bytes = require('node:fs').readFileSync(require('node:path').join(app.getPath('userData'), 'subscription-v1/credentials.enc'));
    const stored = JSON.parse((await safeStorage.decryptStringAsync(bytes)).result);
    return stored.accounts.every(account => !account.tokens);
  }), true);
  assert.deepEqual(errors, []);
  await writeFile(join(data, 'result.json'), JSON.stringify({ status: 'passed', platform: process.platform, packaged: !!packagedApp,
    authentication: 'synthetic OAuth/JWKS/Responses only', osEncryption: 'real Electron safeStorage async',
    checks: ['consent and risk disclosure', 'cancel and browser denial', 'synthetic PKCE login', 'dynamic model selection',
      'SSE without Content-Type', 'guide saved and restored after process restart', 'encrypted credentials restored after restart',
      'no automatic startup requests', 'usage link', 'usage limit error and recovery', 'remote synthetic revocation and local disconnect'],
    realAccountVerified: false, rendererErrors: errors }, null, 2) + '\n');
  console.log('ChatGPT UI passed: 동의·위험 고지, 로그인 취소, 합성 OAuth, 최초 안내, 구독 모델 선택·설명/검토, OS 암호화, 재시작·수동 연결 확인, 사용량 관리, 연결 해제. 실제 계정·외부 추론 호출 없음.');
  console.log('임시 저장소: ' + data);
} catch (error) {
  if (app) { const page = await app.firstWindow(); await page.screenshot({ path: join(screenshots, 'failure.png'), fullPage: true }).catch(() => {}); }
  console.error('UI 검증 저장소: ' + data); throw error;
} finally { if (app) await app.close(); }
