# 기여 안내

Swallow의 자체 작성 코드와 문서는 [MIT 라이선스](LICENSE)를 따릅니다. 제3자 코드·폰트·브랜드는 별도 조건을 유지합니다. 본인이 작성했거나 제출·라이선스할 권한이 있는 변경만 기여해 주세요. 타인 코드, 회사 자료, 유료 문서, 실제 사용자 학습 데이터와 인증 정보를 포함하지 마세요. 별도 CLA나 저작권 양도를 요구하지 않습니다.

## 현재 개발 실행

지원하는 개발용 Node 버전은 **24 LTS (`24.x`)**입니다. `package.json`·lockfile의 프로젝트 선언과 `.nvmrc`를 함께 맞춥니다. Node 22·25·26은 지원 범위가 아니며, npm이 경고만 출력하더라도 Node 24로 전환한 뒤 작업하세요. 의존성 자체의 `engines` 범위는 해당 패키지의 선언이므로 일괄 수정하지 않습니다.

확인한 환경은 macOS 15.6.1 / Apple Silicon입니다. 다른 macOS 버전·Intel Mac·Windows는 아직 검증하지 않았습니다. Git과 PDF helper 빌드를 위한 Xcode Command Line Tools가 필요합니다. 도구가 없다면 [README의 준비 절차](README.md#처음-실행하기)를 따르세요. 현재 검증 기기는 Xcode 전체 설치 환경이며 Command Line Tools만 설치한 환경은 별도 확인이 필요합니다.

새 작업 폴더에서:

```sh
git clone https://github.com/nemory-dev/swallow.git
cd swallow
node --version        # v24.x
npm --version
xcrun --find swiftc
npm ci
npm run dev
```

이미 저장소를 받았다면 해당 폴더에서 도구 확인과 `npm ci`부터 실행합니다. nvm이 이미 설치돼 있다면 `nvm install`·`nvm use`로 `.nvmrc`의 24를 선택할 수 있습니다.

`npm ci`는 패키지를 받고, Electron 44 바이너리는 첫 실행 때 별도로 다운로드될 수 있습니다. 미리 받으려면 `npx install-electron --no`를 실행하세요. `npm run dev`는 빌드 후 앱과 `127.0.0.1:5173` 개발 서버를 엽니다. renderer 변경은 자동 반영되며 `electron/`, `src/shared/`, `src/learning/` 변경은 앱 재시작이 필요합니다. 앱을 `⌘Q`로 종료하거나 개발 서버 터미널에서 `Ctrl+C`로 종료할 수 있습니다.

처음 앱을 체험할 때는 `npm start`로 개발 서버 없이 실행하고 [README의 첫 학습 절차](README.md#처음-실행하기)를 확인하세요. `npm run preview`는 별도 브라우저 저장소의 미리보기이며 데스크톱 기록·AI 생성·PDF 가져오기를 제공하지 않습니다. `dev`·`preview`는 같은 기본 포트를 사용하므로 동시에 실행하지 않습니다. `npm run build`는 개발 출력만 생성하며 설치본을 만들지 않습니다. 실행·검증에 실제 AI 계정·토큰·로컬 모델을 제공할 필요는 없습니다.

공개 소스는 로컬 AI와 AI 없는 학습을 대상으로 합니다. 구독 SDK·로그인·브랜드는 포함하지 않으며 새 제공자를 도입할 때는 사용/재배포 조건과 데이터 흐름을 먼저 검토합니다.

## 변경과 검증

1. 관련 코드·테스트와 저장소 지침을 읽고 `git status --short`로 기존 변경을 확인합니다. 다른 작업의 변경을 되돌리지 않고 작은 범위로 수정합니다.
2. 기능의 정상 동작과 빈 입력·잘못된 입력·저장 실패·취소·시간 초과·권한 부족을 관련 합성 fixture로 확인합니다. 사용자 DB나 인증 파일을 테스트에 사용하지 않습니다.
3. 현재 프로젝트에 존재하는 명령을 실행합니다.

   ```sh
   npm test
   npm run typecheck
   npm run build
   ```

   `npm run check`는 test와 build를 묶습니다. 별도 lint 스크립트는 없습니다.
4. UI 검증은 기존 `scripts/test-*-ui.mjs`의 요구 조건을 확인합니다. [README의 UI 전체 회귀 명령](README.md#검증과-공개-소스-준비)으로 공부·폴더·업데이트·Ollama·한영·번역·PDF 7종을 순차 실행합니다. Playwright·기기·권한 등이 없으면 실행하지 못한 이유를 기록하세요. 빌드 통과를 실제 모델·설치본·서명/공증·스토어 검증으로 표현하지 마세요.
5. 변경 설명에 목적, 변경 범위, 검증 명령과 결과, 미검증 항목, 사용자 데이터 영향을 적습니다. schema·공개 API·build 변경은 기존 데이터/호출자 영향을 설명합니다.

서버 설치·모델 다운로드·외부 AI 호출·계정 변경·배포를 자동 실행하는 테스트를 추가하지 마세요. 로컬 모델 실패 시 구독이나 유료 API로 자동 전환하지 않습니다. 외부 오류·로그에 원문·답안·토큰을 넣지 않습니다.

## UI 검증 준비

앱 실행과 `npm run check`에는 Playwright가 필요하지 않습니다. Electron UI 7종을 검증할 때만 선택 도구로 준비합니다. 현재 확인한 Playwright 버전은 **1.62.1**이며, 프로젝트 의존성과 lockfile을 바꾸지 않도록 별도 임시 도구 폴더에 설치할 수 있습니다.

저장소 루트에서 Node 24로:

```sh
npm run build
export SWALLOW_UI_TOOLS="$(mktemp -d "${TMPDIR:-/tmp}/swallow-ui-tools.XXXXXX")"
npm install --prefix "$SWALLOW_UI_TOOLS" --no-save --package-lock=false playwright@1.62.1
export SWALLOW_PLAYWRIGHT_MODULE="$SWALLOW_UI_TOOLS/node_modules/playwright/index.mjs"
(for flow in study folders update ollama i18n translation pdf; do
  node "scripts/test-${flow}-ui.mjs" || exit 1
done)
```

이미 설치한 Playwright가 있다면 설치 단계 대신 `SWALLOW_PLAYWRIGHT_MODULE`에 해당 `playwright/index.mjs`의 절대 경로를 지정할 수 있습니다. 현재 7종은 프로젝트의 Electron 바이너리를 사용합니다. 테스트는 임시 앱 저장소·합성 AI/업데이트 응답을 사용하고, 설치된 macOS 음성·GUI·localhost·PDF/OCR 권한에 영향을 받습니다. 실패한 시험을 제외해 통과 처리하지 말고 도구 버전·실행 명령·실패 또는 미검증 사유를 함께 기록하세요. 이 결과를 실제 Ollama 모델 품질이나 서명된 설치본 검증으로 표현하지 않습니다.

## 문의와 보안

기여·개인정보 문의는 nemory.dev@gmail.com으로 연락해 주세요. 취약점은 [보안 신고 절차](SECURITY.md)를 따라 같은 이메일에 비공개로 전달합니다. 공개 이슈·PR에 실제 인증 정보나 학습 자료를 첨부하지 마세요.

현재 지원 범위와 공개 소스 검사 명령은 [README](README.md), 외부 구성요소의 원문 고지는 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md), 데이터 처리는 [개인정보 안내](PRIVACY.md)를 확인하세요.
