import type { LibraryScope } from '../src/shared/types.js';
import { validateFolderId } from '../src/learning/folders.js';
import { app, autoUpdater, BrowserWindow, dialog, ipcMain, net, protocol, shell, safeStorage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { readUpdateConfiguration, UpdateService } from './update.js';
import { LibraryStore } from './library.js';
import { AppService } from './app-service.js';
import { toPublicError, localizeText, errorText, PublicError } from '../src/shared/public-errors.js';
import { translate, type AppLanguage } from '../src/shared/i18n.js';
import { OllamaProvider } from './ollama.js';
import { ChatGPTProvider } from './chatgpt.js';
import { CHATGPT_USAGE_URL } from '../src/shared/chatgpt.js';
import { NativeSpeech, installedVoices } from './speech.js';
import { WindowsSpeech, installedWindowsVoices } from './windows-speech.js';
import { PdfStore } from './pdf.js';
import { desktopDataDirectory, pdfWorkerEnvironment, runtimePaths } from './runtime.js';
import { fetchDocumentUrl } from './document-url.js';
import { getDocument, getUnit } from '../src/learning/document.js';
import { studyPassage } from '../src/learning/session.js';
import { termSearchUrl } from './study-input.js';
import type { SpeechInput, SpeechCommand, AddDocumentInput, StudyAction } from '../src/shared/types.js';

app.setName('Swallow');
try {
  const dataDirectory = desktopDataDirectory({ platform: process.platform, override: process.env.SWALLOW_DATA_DIR, localAppData: process.env.LOCALAPPDATA });
  if (dataDirectory) { mkdirSync(dataDirectory, { recursive: true, mode: 0o700 }); app.setPath('userData', dataDirectory); }
} catch { dialog.showErrorBox('Swallow 시작 실패', '사용자 저장 폴더를 열 수 없습니다. 저장 공간과 권한을 확인하세요.'); app.exit(1); }
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = resolve(currentDirectory, '../../dist');
const { devUrl, homeUrl, pdfHelper, windowsPdfWorker, speechHelper } = runtimePaths({
  packaged: app.isPackaged, resourcesPath: process.resourcesPath, currentDirectory, devUrl: process.env.SWALLOW_DEV_URL,
});
protocol.registerSchemesAsPrivileged([{ scheme: 'swallow', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window: BrowserWindow | null = null;
let service: AppService;
const speech = process.platform === 'win32' ? new WindowsSpeech(speechHelper) : new NativeSpeech();
const desktopVoices = () => process.platform === 'win32' ? installedWindowsVoices(speechHelper) : installedVoices();
let fetchingDocument = false;
let importing: AbortController | null = null;
let importCommitStarted = false;
let activeOperations = 0;
let installingUpdate = false;
let maintainingStorage = false;
const pdfStore = new PdfStore(join(app.getPath('userData'), 'pdf'), process.platform === 'win32'
  ? { command: process.execPath, args: ['--max-old-space-size=512', windowsPdfWorker, '--parent-pid', String(process.pid)], env: pdfWorkerEnvironment(process.env), resultFd: 3 }
  : pdfHelper);
const csp = `default-src 'self'; script-src 'self'${devUrl ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${devUrl ? "'self' ws://127.0.0.1:5173" : "'none'"}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;

function uiLanguage(): AppLanguage {
  try { return service?.getState().language?.preferences.uiLocale ?? 'ko'; }
  catch { return 'ko'; }
}
const nativeText = (text: string) => localizeText(text, uiLanguage());

function createWindow() {
  window = new BrowserWindow({
    title: 'Swallow', width: 1460, height: 940, minWidth: 1000, minHeight: 680,
    backgroundColor: '#f6f5ef', autoHideMenuBar: true,
    webPreferences: { preload: join(currentDirectory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-prevent-unload', event => {
    if (!window) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', title: nativeText('저장되지 않은 답안'),
      message: nativeText('임시 답안을 자동 보관하지 못했습니다.'),
      detail: nativeText('화면으로 돌아가 답안을 저장하세요. 저장하지 않고 닫으면 입력을 잃을 수 있습니다.'),
      buttons: [nativeText('돌아가서 저장'), nativeText('저장하지 않고 닫기')], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== homeUrl) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  window.on('closed', () => { speech.control('stop'); service.cancelRequest(); importing?.abort(); window = null; });
  void window.loadURL(homeUrl).catch(() => dialog.showErrorBox(nativeText('Swallow를 열 수 없습니다'), nativeText('npm run build가 완료되었는지 확인해 주세요.')));
}

function registerHandler(name: string, action: (...args: unknown[]) => unknown) {
  ipcMain.handle(`swallow:${name}`, async (event, ...args) => {
    try {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || frame !== event.sender.mainFrame ||
        (devUrl ? frame.url !== devUrl + '/' : frame.url !== homeUrl)) throw new Error('허용하지 않는 화면의 요청입니다.');
      if (installingUpdate && name !== 'update-state') throw new PublicError('public.updateInstallingBusy');
      const tracked = !['get-state', 'update-state', 'study-workspace', 'speech-state'].includes(name);
      if (tracked) activeOperations++;
      try { return { ok: true, value: await action(...args) }; }
      finally { if (tracked) activeOperations--; }
    } catch (error) { return { ok: false, error: toPublicError(error) }; }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    protocol.handle('swallow', async request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
        const path = resolve(distDirectory, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        const rel = relative(distDirectory, path);
        if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 });
        return await net.fetch(pathToFileURL(path).href);
      } catch { return new Response('Not found', { status: 404 }); }
    });
    service = new AppService(new LibraryStore(join(app.getPath('userData'), 'library.json')), new OllamaProvider(join(app.getPath('userData'), 'ollama.json')), undefined, new ChatGPTProvider({
      directory: join(app.getPath('userData'), 'subscription-v1'), openExternal: url => shell.openExternal(url),
      protection: { available: async () => ['darwin', 'win32'].includes(process.platform) && await safeStorage.isAsyncEncryptionAvailable(),
        encrypt: text => safeStorage.encryptStringAsync(text), decrypt: async bytes => (await safeStorage.decryptStringAsync(bytes)).result },
    }));
    service.subscribe(state => { if (window && !window.isDestroyed()) window.webContents.send('swallow:state', state); });
    let updateConfiguration: unknown;
    let updateConfigurationError = false;
    if (app.isPackaged) {
      try { updateConfiguration = await readUpdateConfiguration(join(app.getAppPath(), 'update-config.json')); }
      catch { updateConfigurationError = true; }
    }
    const updates = new UpdateService(autoUpdater, {
      currentVersion: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch,
      configuration: updateConfiguration, configurationError: updateConfigurationError, store: !!process.mas || !!process.windowsStore,
      windowsInstaller: existsSync(resolve(dirname(process.execPath), '..', 'Update.exe')),
      windowsFirstRun: process.argv.includes('--squirrel-firstrun'),
    });
    updates.subscribe(state => {
      if (!['preparing', 'installing'].includes(state.status)) installingUpdate = false;
      if (window && !window.isDestroyed()) window.webContents.send('swallow:update-state', state);
    });
    registerHandler('update-state', () => updates.state);
    registerHandler('check-updates', () => updates.check());
    registerHandler('install-update', async () => {
      const state = service.getState();
      if (activeOperations > 1 || importing || fetchingDocument || maintainingStorage || state.busy) throw new Error('진행 중인 작업을 마친 뒤 업데이트해 주세요.');
      installingUpdate = true;
      try { await updates.install(async () => { speech.control('stop'); }); }
      catch (error) { installingUpdate = false; throw error; }
    });
    app.once('will-quit', () => updates.dispose());
    registerHandler('create-folder', name => service.createFolder(name as string));
    registerHandler('rename-folder', (id, name) => service.renameFolder(id as string, name as string));
    registerHandler('delete-folder', id => service.deleteFolder(id as string));
    registerHandler('move-document', (id, folderId) => service.moveDocument(id as string, folderId as string | null));
    registerHandler('get-state', () => service.getState());
    registerHandler('translate-document', (id, language, scope, unitId) => service.translateDocument(id as string,
      language as import('../src/shared/types.js').ResponseLanguage, scope as import('../src/shared/types.js').TranslationScope, unitId as string | undefined));
    registerHandler('set-language-preferences', preferences => service.setLanguagePreferences(preferences as import('../src/shared/i18n.js').LanguagePreferences));
    registerHandler('chatgpt:connect', (consent, accountId) => service.connectChatGPT(consent as string, accountId as string | undefined));
    registerHandler('chatgpt:cancel-sign-in', () => service.cancelChatGPTSignIn());
    registerHandler('chatgpt:refresh', () => service.refreshChatGPT());
    registerHandler('chatgpt:disconnect', () => service.disconnectChatGPT());
    registerHandler('chatgpt:acknowledge', () => service.acknowledgeChatGPT());
    registerHandler('chatgpt:usage', () => shell.openExternal(CHATGPT_USAGE_URL));
    registerHandler('ai:refresh-models', () => service.refreshModels());
    registerHandler('ollama:connect', endpoint => service.connectOllama(endpoint as import('../src/shared/types.js').OllamaEndpoint));
    registerHandler('ollama:refresh', () => service.refreshOllama());
    registerHandler('ollama:disconnect', () => service.disconnectOllama());
    registerHandler('study-workspace', id => service.getStudyWorkspace(id as string));
    registerHandler('study-session', action => { speech.control('stop'); return service.studySession(action as import('../src/shared/types.js').SessionAction); });
    registerHandler('study-explain', (id, style) => { speech.control('stop'); return service.explainStudy(id as string, style as import('../src/shared/types.js').ExplanationStyle); });
    registerHandler('study-feedback', id => { speech.control('stop'); return service.feedbackStudy(id as string); });
    registerHandler('study-save-note', id => { speech.control('stop'); return service.saveStudyNote(id as string); });
    registerHandler('study-search-notes', (query, scope) => service.searchStudyNotes(query as string, scope as LibraryScope | undefined));
    registerHandler('study-term', (id, term, url) => service.explainTerm(id as string, term as string, url as string | undefined));
    registerHandler('study-web-search', term => shell.openExternal(termSearchUrl(term)));
    registerHandler('study-speak', async (id, content, voice, rate) => {
      const state = service.getState();
      if (state.library.activeDocumentId !== id) throw new Error('현재 공부 중인 자료를 선택하세요.');
      const doc = getDocument(state.library, id as string), session = service.getStudyWorkspace(doc.id).session;
      if (!session || !['source', 'explanation'].includes(content as string)) throw new Error('먼저 공부 시작을 눌러 주세요.');
      const text = content === 'source' ? studyPassage(doc, session) : session.guide?.overview;
      if (!text) throw new Error('먼저 짧은 설명을 받아 주세요.');
      await speech.speak(text, voice as string, rate as number);
    });
    registerHandler('search-library', (query, scope) => service.searchLibrary(query as string, scope as LibraryScope | undefined));
    registerHandler('open-evidence', reference => { speech.control('stop'); return service.openEvidence(reference as import('../src/shared/types.js').EvidenceReference); });
    registerHandler('archive-document', id => { speech.control('stop'); return service.archiveDocument(id as string); });
    registerHandler('restore-document', id => service.restoreDocument(id as string));
    registerHandler('auto-archive', enabled => service.setAutoArchive(enabled as boolean));
    registerHandler('compact-storage', () => service.compactStorage());
    registerHandler('add-document', input => { if ((input as AddDocumentInput)?.pdf !== undefined) throw new Error('PDF는 파일 가져오기를 이용하세요.'); speech.control('stop'); return service.addDocument(input as AddDocumentInput); });
    registerHandler('study', input => {
      const action = input as StudyAction;
      if (['select-document', 'select-unit', 'delete-document'].includes(action?.type)) speech.control('stop');
      return service.study(action);
    });
    registerHandler('fetch-document-url', async url => {
      if (fetchingDocument) throw new Error('다른 문서를 가져오는 중입니다. 잠시 기다리세요.');
      fetchingDocument = true;
      try { return await fetchDocumentUrl(url); } finally { fetchingDocument = false; }
    });
    registerHandler('cancel-import', () => { if (!importCommitStarted) importing?.abort(); });
    registerHandler('render-pdf-page', (documentId, page) => {
      const doc = getDocument(service.getState().library, documentId as string);
      if (!doc.pdf?.pages.some(value => value.page === page)) throw new Error('PDF 페이지를 찾을 수 없습니다.');
      return pdfStore.render(doc.pdf.assetId, page as number);
    });
    registerHandler('speech-voices', desktopVoices);
    registerHandler('speech-state', () => speech.state);
    registerHandler('speak', async input => {
      const options = input as SpeechInput;
      const library = service.getState().library;
      const doc = getDocument(library, options?.documentId); const unit = getUnit(doc, options?.unitId);
      if (library.activeDocumentId !== doc.id || doc.units[doc.position]?.id !== unit.id) throw new Error('현재 읽기 구간을 선택하세요.');
      await speech.speak(unit.text, options.voiceId, options.rate);
    });
    registerHandler('control-speech', command => speech.control(command as SpeechCommand));
    speech.subscribe(state => { if (window && !window.isDestroyed()) window.webContents.send('swallow:speech-state', state); });
    registerHandler('guide', (documentId, unitId) => service.generate('guide', documentId as string, unitId as string));
    registerHandler('feedback', (documentId, unitId) => service.generate('feedback', documentId as string, unitId as string));
    registerHandler('cancel-request', () => service.cancelRequest());
    registerHandler('import-document', async target => {
      const folderId = target === undefined || target === null ? null : validateFolderId(target as string);
      if (folderId && !service.getState().folders?.some(folder => folder.id === folderId)) throw new PublicError('public.folderMissing');
      if (!window) return;
      if (importing) throw new Error('다른 파일을 가져오는 중입니다.');
      const controller = new AbortController(); importing = controller;
      try {
        const result = await dialog.showOpenDialog(window, { title: translate(uiLanguage(), 'native.importTitle'), properties: ['openFile'], filters: [{ name: translate(uiLanguage(), 'native.importFilter'), extensions: ['pdf', 'txt', 'md', 'markdown'] }] });
        const path = result.filePaths[0];
        if (result.canceled || !path) return;
        controller.signal.throwIfAborted();
        const extension = extname(path).toLowerCase();
        const title = basename(path, extname(path)).slice(0, 160);
        if (extension === '.pdf') {
          window?.webContents.send('swallow:import-state', { status: 'importing', message: 'PDF 텍스트와 스캔 OCR을 추출하는 중… 최대 120초' });
          const imported = await pdfStore.import(path, title, controller.signal);
          try {
            controller.signal.throwIfAborted();
            importCommitStarted = true;
            window?.webContents.send('swallow:import-state', { status: 'saving', message: 'PDF 학습 자료를 저장하는 중…' });
            speech.control('stop');
            await service.addDocument({ ...imported.input, folderId });
          } catch (error) { await imported.rollback(); throw error; }
          return;
        }
        if (!['.txt', '.md', '.markdown'].includes(extension)) throw new Error('PDF·텍스트·Markdown 파일만 열 수 있습니다.');
        if ((await stat(path)).size > 4_000_000) throw new Error('텍스트 파일은 4MB 이내로 선택해 주세요.');
        const bytes = await readFile(path);
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (source.includes('\0')) throw new Error('텍스트 파일이 아닙니다. UTF-8 텍스트 파일을 선택해 주세요.');
        controller.signal.throwIfAborted();
        speech.control('stop');
        await service.addDocument({ title, source, goal: '', folderId });
      } catch (error) {
        if (controller.signal.aborted) throw new Error('파일 가져오기를 취소했습니다.');
        if (toPublicError(error).code !== 'errors.unexpected') throw new PublicError(toPublicError(error).code);
        throw new Error('파일을 읽을 수 없습니다. 파일 형식과 권한을 확인하세요.');
      } finally {
        importing = null; importCommitStarted = false;
        window?.webContents.send('swallow:import-state', { status: 'idle', message: '' });
      }
    });
    await service.initialize(app.getPreferredSystemLanguages()).catch(() => { /* get-state returns the preserved startup error to the renderer. */ });
    createWindow();
    const maintain = () => {
      if (installingUpdate || maintainingStorage) return;
      maintainingStorage = true;
      void service.maintainStorage().catch(error => { if (window && !window.isDestroyed()) dialog.showErrorBox(nativeText('저장소 유지 관리 실패'), errorText(error, uiLanguage())); }).finally(() => { maintainingStorage = false; });
    };
    maintain();
    const maintenanceTimer = setInterval(maintain, 24 * 60 * 60 * 1000); maintenanceTimer.unref();
    app.once('will-quit', () => clearInterval(maintenanceTimer));
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(() => { dialog.showErrorBox(nativeText('Swallow 시작 실패'), nativeText('앱 초기화에 실패했습니다. 앱 파일과 사용자 저장 폴더의 권한을 확인해 주세요.')); app.quit(); });
  app.on('will-quit', () => { speech.control('stop'); importing?.abort(); service?.dispose(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
