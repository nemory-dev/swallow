# ChatGPT 구독 연결 베타

확인일: Mac 2026-10-24, Windows 2026-10-25. 대상: [Mac `v0.1.1-beta.1`](https://github.com/nemory-dev/swallow/releases/tag/v0.1.1-beta.1)·[Windows `v0.1.1-windows-beta.1`](https://github.com/nemory-dev/swallow/releases/tag/v0.1.1-windows-beta.1)(앱 내부 버전 모두 `0.1.1-beta.1`)와 해당 소스. 이전 공개 `0.1.0` 계열 설치본에는 이 기능이 없습니다. 두 플랫폼의 사용자용 배포 단계 명칭은 **베타**이며 서명·공증·지원 기기 확대를 의미하지 않습니다.

## 이번 버전의 연결 범위

| 제공자 | 공식 문서 확인 결과 | 이번 구현 |
| --- | --- | --- |
| ChatGPT | 무료 오픈소스·로컬 앱용 공식 OAuth와 구독 추론 경로 제공 | 공식 브라우저 로그인 → Swallow 안에서 자동 요청·결과 저장 |
| Gemini | Gemini CLI의 제공자 인증 토큰을 제3자 앱에서 재사용하는 방식은 제한 | 제외 |
| Claude | 제3자 제품에서 Claude.ai 구독 로그인/토큰을 사용하는 방식은 사전 승인이 필요 | 제외 |

Gemini·Claude에 요청문을 복사하고 사용자가 공식 웹앱에서 직접 실행하는 기능도 넣지 않습니다. Ollama와 AI 없는 학습은 계속 사용할 수 있습니다. ChatGPT 비밀번호·쿠키 수집, 다른 앱 토큰 복사, 수정된 과거 SDK 재사용, 비공개 ChatGPT backend 호출은 하지 않습니다.

## 연결과 사용

1. [Windows 베타 릴리스](https://github.com/nemory-dev/swallow/releases/tag/v0.1.1-windows-beta.1)의 ZIP 또는 [Mac 베타 릴리스](https://github.com/nemory-dev/swallow/releases/tag/v0.1.1-beta.1)의 DMG를 설치해 엽니다. 소스 실행에는 [README의 개발 환경](../README.md#소스로-실행하기--개발자용)이 필요합니다.
2. 상단 **AI 연결 → ChatGPT 구독 연결 · 베타**에서 외부 전송·사용량·저장·계정 제한 안내를 읽고 동의합니다.
3. **Continue with ChatGPT**를 누릅니다. 기본 브라우저의 OpenAI 페이지에서 본인이 로그인하고 구독 사용을 허용합니다. 브라우저에서 동의를 거절하거나 앱의 **로그인 취소**를 누를 수 있습니다.
4. 처음 연결하면 구독 사용 안내가 표시됩니다. 학습 화면의 **모델 설정**에서 `· ChatGPT` 모델을 직접 선택한 뒤 설명·피드백·번역 초안을 요청합니다. 사용 가능한 모델은 계정별 공식 목록에서 가져옵니다.
5. 앱을 다시 실행하면 **AI 연결 → ChatGPT 모델 확인**을 눌러 저장된 연결을 먼저 잠금 해제합니다. 시작만으로 자동 외부 요청을 보내지 않습니다. 기존 계정 재인증은 계정 선택란에서 저장된 연결을 선택하세요. 같은 이메일의 서로 다른 등록/워크스페이스도 별도 연결로 다룹니다.
6. **사용량 관리**에서 ChatGPT의 사용량·권한을 확인합니다. **ChatGPT 연결 해제**는 원격 세션 철회와 로컬 토큰 삭제를 수행합니다. 원격 철회 미확인 안내가 있으면 ChatGPT 설정에서도 직접 연결을 해제하세요.

실행 가능한 자격·구독·워크스페이스·지역·모델·한도는 OpenAI가 결정합니다. 특정 플랜의 무조건적인 지원이나 무제한 사용을 약속하지 않습니다. Swallow는 무료지만 요청은 기존 구독 허용량 또는 ChatGPT 설정에서 허용한 크레딧을 소비할 수 있습니다. 한도 오류 시 자동 계정 순환·유료 API 전환·크레딧 구매는 하지 않습니다.

## 데이터와 계정 제한 위험

선택한 원문 구간, 필요한 이전 맥락·질문·답안과 지침이 OpenAI로 전송됩니다. 설명 후 근거 검토, 번역 분할·재생성으로 한 번의 버튼 동작에 여러 요청이 발생할 수 있습니다. PDF는 번역에 필요한 추출 텍스트만 보내며 이미지 설명은 지원하지 않습니다. AI 결과는 원문과 비교하세요.

인증정보는 Electron 메인 프로세스에서만 처리하며 OS 보호를 사용하는 암호화 파일로 저장합니다. OS 보호를 사용할 수 없거나 인증 검증에 실패하면 연결을 중단합니다. OS 키 저장소는 사용자가 연결을 요청할 때 비동기로 열고 30초 이상 기다리지 않습니다. 미서명·ad-hoc Mac 베타는 빌드 교체 후 Keychain 접근 확인이 다시 나타날 수 있습니다. 확인은 사용자가 직접 판단합니다. 앱 시작과 AI 없는 학습에서는 키체인을 요청하지 않습니다. Windows의 비동기 OS 보호는 DPAPI를 사용하며 다른 Windows 사용자로부터 보호하지만 같은 사용자로 실행되는 다른 앱에 대한 완전한 격리를 보장하지 않습니다. 다른 PC·사용자에게 인증 파일을 복사하지 말고 새로 로그인하세요. 원문·노트·번역 등이 있는 SQLite와 PDF는 별도로 암호화하지 않습니다. 자세한 전송·저장·삭제 범위는 [개인정보 안내](../PRIVACY.md)를 확인하세요.

**약관 위반·오남용 시 OpenAI의 앱 접근 차단 또는 계정 정지·종료가 발생할 수 있습니다.** 공식 연결을 사용해도 접근 지속이나 무제한 사용을 보장할 수 없습니다. Gemini CLI의 OAuth/백엔드 접근을 제3자 앱으로 우회하는 방식은 Google 문서상 즉시 정지·종료 대상이 될 수 있어 채택하지 않았습니다. Claude 구독 인증을 임의 재사용하는 제3자 통합 역시 허용된 것으로 간주하지 않습니다.

## 문제 해결

| 증상 | 확인·복구 |
| --- | --- |
| 로그인했지만 구독 사용 권한이 없음 | 같은 저장된 연결을 선택하고 다시 동의합니다. 구독 사용이 허용되지 않으면 요청할 수 없습니다. |
| 로그인 취소/시간 초과 | 브라우저와 앱의 상태를 확인하고 새 로그인을 시작합니다. 이전 callback이나 코드를 재사용하지 않습니다. |
| 모델이 없거나 선택한 모델이 사라짐 | 모델 확인 후 목록에서 다시 선택합니다. 다른 제공자로 자동 전환하지 않습니다. |
| 한도·지역·권한 오류 | 사용량/권한을 확인합니다. 무한 재시도나 계정 순환을 하지 않습니다. |
| 암호화 저장 실패 | Mac에서 Keychain 접근을 직접 허용한 뒤 **ChatGPT 모델 확인**을 다시 누릅니다. OS 로그인/Keychain 또는 Windows 계정 보호와 저장 폴더 권한을 확인한 뒤 다시 연결합니다. 저장 실패가 계속되면 앱을 재시작합니다. 인증 파일을 다른 사용자에게 보내지 마세요. |
| 중간까지 출력되고 실패함 | 완료 이벤트 없는 출력은 새 결과로 저장하지 않습니다. 기존 원문·답안·노트는 유지합니다. |
| 로그아웃 후 서버 철회 미확인 | 로컬 토큰은 삭제됐습니다. ChatGPT 설정에서 Swallow 접근을 직접 철회합니다. |

## 구현과 검증 경계

공식 OAuth PKCE·state·nonce·JWT 서명/issuer/audience/만료/동일 사용자 검사, 발급 client ID와 안정된 host ID 보존, 원자적 암호화 저장, refresh 직렬화, 한도 오류와 취소 처리를 포함합니다. 요청은 공식 `/v1/models` 및 `/v1/responses`만 사용하며 `store:false`·스트리밍 완료 확인을 적용합니다. 인증 오류의 원문·토큰은 UI로 전달하지 않습니다. JWT 검증에는 MIT 라이선스 `jose`를 사용합니다.

합성 OAuth/JWKS/Responses와 별도 임시 데이터로 자동 검증했으며 전체 570개 테스트가 통과했습니다(Windows 전용 7개 제외). 2026-10-24 macOS 15.6.1 / M1 Pro에서 사용자가 직접 로그인·연결 동의·Keychain 허용을 완료한 뒤 모델 조회, GPT-6.1-Sol의 합성 원문 설명 생성·저장, 화면 새로고침 후 복원을 확인했습니다. 실제 응답의 Content-Type 헤더 누락을 처리하도록 수정한 동일 DMG를 배포합니다. Windows `0.1.1-beta.1` 설치본은 [Windows CI](https://github.com/nemory-dev/swallow/actions/runs/40107410476)에서 빌드 후와 소스 없는 별도 VM에서 합성 OAuth/JWKS/Responses·실제 비동기 OS 암호화·취소/거절·한도 오류/복구·설명 저장/프로세스 재시작 복원·합성 철회/로컬 토큰 삭제를 확인했습니다. 이 시험은 실제 OpenAI 로그인·추론 호출이 아닙니다. **새 Windows 버전의 실제 사용자 PC·실계정 연결/추론·물리 음성 청취와 두 플랫폼의 개별 사용량 차감·실제 서버 철회는 미검증입니다.** 한 계정·모델의 성공이 모든 계정 자격·AI 결과 정확성·향후 정책 호환성을 보장하지 않습니다.

개발 검증은 Node 24에서 다음 명령을 사용합니다.

```sh
npm run check
npm run source:check
node scripts/test-chatgpt-ui.mjs
node scripts/test-ollama-ui.mjs
npm run make:mac:arm64
```

## 공식 근거

- OpenAI: [무료 오픈소스 앱의 구독 사용](https://developers.openai.com/siwc/token-sharing-open-source), [로그인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [계정·refresh·철회](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [모델·추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [오류 복구](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [UI 지침](https://developers.openai.com/siwc/ui-ux-guidelines), [연결 약관](https://openai.com/policies/sign-in-with-chatgpt-terms/), [이용약관](https://openai.com/policies/terms-of-use/).
- Google: [Gemini CLI FAQ](https://geminicli.com/docs/resources/faq/), [약관·개인정보와 제3자 도구 제한](https://geminicli.com/docs/resources/tos-privacy/).
- Anthropic: [법적 준수·인증 제한](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK 인증](https://code.claude.com/docs/en/agent-sdk/overview), [프로그램 방식 실행](https://code.claude.com/docs/en/headless). 원본 Claude Code 바이너리 재배포/임베딩 조건과 제3자 구독 로그인 허용 여부는 별개입니다. 이 문서들만으로 Swallow의 임의 구독 자동화가 승인됐다고 해석하지 않았습니다.
