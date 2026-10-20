# Windows x64 시험판 실행 안내

이 문서는 Windows 11 x64용 ZIP 시험판 후보의 실행 절차입니다. 파일을 만들었다는 사실과 실제 Windows 검증 통과는 다릅니다. 배포받은 파일의 `BUILD-INFO.json`과 해당 빌드의 smoke 결과를 함께 확인하세요. GitHub의 Windows runner는 Windows Server이며, 회사 Windows 11 PC의 실행 정책·오디오 출력까지 검증하지는 않습니다.

## 준비 사항

- Windows 11, Intel/AMD x64 PC와 사용자가 쓸 수 있는 로컬 폴더가 필요합니다. Windows ARM64·32비트는 이번 시험 대상이 아닙니다.
- ZIP 전체를 해제할 공간이 필요합니다. 짧은 로컬 경로를 사용하세요. 예: `C:\Users\사용자\Apps\Swallow`.
- 실행에 Node.js·npm·소스 코드·Python·Swift·별도 OCR 도구는 필요하지 않습니다. Ollama는 로컬 AI 기능을 사용할 때만 별도로 준비합니다.
- 회사 PC에서는 조직의 실행·자료 처리 정책을 따르세요. 앱과 학습 자료를 개인 서비스에 업로드할 필요가 없습니다.

## 파일 확인과 실행

1. 전달받은 `Swallow-<버전>-windows-x64-trial-unsigned.zip`, `SHA256SUMS`, `BUILD-INFO.json`을 같은 폴더에 둡니다. GitHub Actions에서 받는 경우 **전체 workflow가 성공한 실행의 `Swallow-windows-x64-trial-…` artifact**를 선택합니다. `windows-preview-build-…`는 중간 검증용이고, `windows-preview-harness-…`는 시험 도구입니다.
2. PowerShell에서 파일명이 일치하는지 확인하고 다음 명령으로 해시를 구합니다. `SHA256SUMS`의 같은 파일명 행과 모든 문자가 같아야 합니다.

   ```powershell
   Get-FileHash -Algorithm SHA256 .\Swallow-0.1.0-windows-x64-trial-unsigned.zip
   Get-Content .\SHA256SUMS
   ```

   체크섬은 파일이 전달 중 바뀌었는지 비교하는 값이며, 개발자 신원을 보증하는 코드 서명은 아닙니다. `BUILD-INFO.json`의 commit·버전·Windows x64 대상도 확인합니다.
3. ZIP 우클릭 → **모두 압축 풀기**로 전체를 해제합니다. 해제된 `Swallow` 폴더 안의 `Swallow.exe`를 실행합니다. ZIP 미리보기 안에서 실행하거나 EXE만 다른 폴더로 옮기면 필요한 DLL·PDF/OCR 자원을 찾지 못합니다.
4. 처음에는 아래의 짧은 예제로 확인합니다. 실제 업무 자료는 실행·저장 정책을 확인한 뒤 사용하세요.

이 시험판은 **코드 서명이 없습니다**. SmartScreen, 앱 제어, 백신, 회사 정책이 앱이나 `resources\native\swallow-speech.exe`의 실행을 막을 수 있습니다. 차단되면 파일 출처·체크섬·오류 문구를 확인하고 IT 담당자에게 허용 여부를 문의하세요. 보안 기능 해제, 실행 정책 우회, 관리자 실행은 설치 절차에 포함하지 않습니다. 앱 실행 허용과 음성 helper 실행 허용은 별개일 수 있습니다.

## 첫 확인 순서

1. 앱의 짧은 예제 문서를 열고 공부를 시작합니다. 답변과 요점노트를 저장합니다.
2. 텍스트 PDF를 가져와 본문과 페이지 이미지를 확인하고, PDF 메모를 저장합니다.
3. 한국어·영어가 포함된 짧은 스캔 PDF를 가져와 OCR 텍스트를 원본과 대조합니다. 추출과 OCR은 설치본의 로컬 자원을 사용하며 언어 데이터를 실행 중 다운로드하지 않습니다.
4. 읽어 주기를 시작하고 일시정지·계속·중지를 확인합니다. 한국어와 영어 음성이 모두 보이면 언어별로 시험합니다.
5. 앱을 완전히 종료한 뒤 다시 열어 문서·답변·요점노트·PDF 메모와 이미지가 남아 있는지 확인합니다.
6. 오프라인 사용을 확인하려면 앱의 로컬 읽기·저장·PDF/OCR·음성을 시험합니다. 공개 웹 문서 가져오기에는 인터넷이 필요하고, AI 기능에는 별도로 실행 중인 로컬 Ollama가 필요합니다.

PDF는 파일당 40MB, 최대 300쪽 제한이 있습니다. 가져오기 시간 제한은 120초이며, 이는 300쪽 스캔 처리를 보장하는 시간이 아닙니다. 스캔은 문자 인식에 시간이 걸리므로 먼저 1~2쪽으로 시험하고 큰 파일은 나눠 주세요. 암호화·손상된 PDF는 거절합니다. OCR은 글자·표·수식·배치가 틀릴 수 있으므로 원본과 비교하세요.

## 읽어 주기

Windows의 로컬 System.Speech/SAPI5 음성만 사용합니다. 인터넷 음성 서비스나 마이크 녹음은 사용하지 않습니다. Windows 설정에 보이는 모든 음성이 SAPI5 목록에 표시되는 것은 아니며, OneCore 전용 음성은 앱에 보이지 않을 수 있습니다.

음성이 없으면 기기의 언어·음성 설정과 조직의 설치 정책을 확인하세요. 한국어 음성 설치 여부와 실제 재생은 PC마다 다릅니다. CI의 WAV 합성 성공은 스피커 출력이나 한국어 음성 가용성을 뜻하지 않습니다. 음성을 사용할 수 없어도 문서 읽기·저장 기능은 계속 사용할 수 있습니다.

읽기 속도 선택은 Windows 음성 엔진의 속도 값에 근사해 적용합니다. 실제 빠르기는 설치된 음성마다 다를 수 있습니다.

## 저장 위치와 백업

기본 저장 위치는 `%LOCALAPPDATA%\Swallow`입니다. 파일 탐색기 주소창에 이 경로를 붙여 넣으면 열립니다. ZIP을 새로 풀거나 앱 폴더를 옮겨도 학습 자료는 이 별도 위치에 남습니다. 자료는 앱 자체에서 암호화하지 않습니다.

백업할 때는 앱을 완전히 종료하고 `Swallow` 데이터 폴더 전체를 별도 보관하세요. SQLite DB 하나만 복사하면 PDF 원본·백업·추가 기록을 놓칠 수 있습니다. PDF 원본·legacy 파일·백업은 문서 삭제 후에도 남을 수 있습니다. 데이터를 삭제하거나 덮어쓰기 전에 백업을 확인하세요.

개발자 시험에서만 절대 경로의 `SWALLOW_DATA_DIR`로 저장 위치를 바꿀 수 있습니다. 두 앱을 같은 데이터 폴더로 동시에 시험하지 마세요.

## 문제를 만났을 때

| 증상 | 확인 방법 |
| --- | --- |
| EXE가 열리지 않음·보안 정책 차단 | ZIP 전체 해제, 체크섬, Windows x64 여부, 조직의 실행 허용 정책 확인 |
| DLL·PDF 자원 누락 | EXE만 복사하지 않았는지 확인하고 원본 ZIP을 새 로컬 폴더에 다시 해제. 임의 DLL 다운로드는 하지 않음 |
| PDF 가져오기 실패 | 40MB·쪽 수·암호 여부 확인. 작은 정상 PDF로 재시험. 기존 자료는 보존하고 오류 문구 확인 |
| 스캔 처리 시간 초과 | 페이지를 나누어 재시도. OCR 처리 중 취소 후 원본과 기존 자료 확인 |
| 읽어 주기 오류 | SAPI5 음성 가용성, 오디오 출력, helper 실행 차단 확인 |
| 저장 실패 | `%LOCALAPPDATA%\Swallow`의 로컬 저장 권한과 디스크 공간 확인. 백업 전 DB 삭제 금지 |

문의를 전달할 때는 Windows 버전·CPU·앱 버전·commit·오류 문구·재현 순서를 적으세요. 개인 DB, PDF, 학습 원문, 답안, 토큰은 첨부하지 마세요. 자동 업데이트는 제공하지 않으며 새 ZIP을 수동으로 받아 전체 해제하는 방식입니다.

## 개발자 패키징과 검증

Windows x64 / Node 24에서 저장소의 고정 의존성을 설치한 뒤 실행합니다. 빌드 중 npm/Electron·원문 라이선스를 받는 네트워크 사용은 설치본의 실행 중 동작과 별개입니다.

네이티브 고지는 정확한 Windows canvas SBOM과 Tesseract core 소스의 고정 revision에 맞춰 준비합니다. Skia·FreeType·HarfBuzz·이미지 라이브러리·Tesseract·Leptonica 및 SBOM의 Rust 구성요소 원문을 고정 URL/체크섬으로 검증해 `resources\licenses\native`에 보존합니다. 원문을 받을 수 없거나 해시가 다르면 패키징은 중단됩니다. Rust 원본 archive는 빌드 중 고지만 읽고 폐기하며 설치본에 소스 archive를 넣지 않습니다. `inventory.json`은 확보한 원문과 출처의 기록이며 법적 검토 완료를 뜻하지 않습니다. SBOM에는 빌드 의존성·다른 플랫폼 대안이 함께 기록될 수 있어 실제 링크 범위와 파일별 추가 고지는 일반 공개 전에 별도로 확인해야 합니다.

```powershell
npm ci
npm run source:check
npm test
npm run package:win:x64
```

결과는 `artifacts/windows-preview/unsigned-…/` 아래에 생성됩니다. ZIP 안에는 최상위 `Swallow` 폴더 하나, `README-WINDOWS.txt`, `BUILD-INFO.json`과 앱 전체 파일이 들어갑니다. 체크섬·독립 시험 하네스·smoke 결과는 ZIP 밖에 생성됩니다. 패키징 명령은 GitHub 업로드·릴리스 공개·workflow 실행을 하지 않습니다.

별도 ZIP을 다시 시험할 때는 실제 출력 경로로 바꾸어 실행합니다.

```powershell
node scripts/test-packaged-windows.mjs --zip C:\build\Swallow.zip --fixtures C:\src\swallow\tests\fixtures\pdf --output C:\build\smoke
```

CI의 두 번째 job은 소스를 checkout하지 않고 앱 ZIP과 별도 하네스만 받습니다. 테스트 도구용 Node·Playwright는 사용하지만 앱과 PDF 자식에는 `System32`만 PATH로 전달합니다. 설치 폴더 쓰기 거절을 실제 검사하고, `Swallow.exe`와 음성 helper의 외부 통신을 Windows Firewall로 차단한 뒤 PDF/OCR·SQLite·재실행·WAV·UI를 시험합니다. `--ci-restrictions`는 이 격리된 CI에서만 사용하며 끝나면 ACL·방화벽 규칙과 프로필을 복구합니다. 사용자 PC의 권한·방화벽을 변경하는 절차가 아닙니다.

### CI 자동 실행과 결과 확인

`Build and verify Windows x64 trial`은 `main` push와 `main` 대상 PR의 생성·재오픈·커밋 갱신 때 실행됩니다. 작업 브랜치의 push만으로는 실행하지 않아 같은 변경의 push·PR 중복 실행을 피합니다. Actions의 **Run workflow**로 선택한 브랜치를 수동 검증할 수도 있습니다. 자동 실행은 문서 변경도 포함하며, 한 번의 전체 검증에 Windows runner 두 job을 사용합니다.

같은 PR에 새 커밋이 올라오면 이전 실행을 취소하고 최신 변경을 검증합니다. `main` push와 수동 실행은 별도 그룹을 사용하며, 같은 이벤트·ref의 진행 중 검사는 취소하지 않습니다. 그룹마다 대기 실행은 최신 한 개만 유지하므로 연속 요청 시 이전 대기 실행은 취소될 수 있습니다. [GitHub concurrency 규칙](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)을 따릅니다.

PR 검증은 PR과 대상 브랜치를 합친 임시 merge commit을 checkout하므로 `BUILD-INFO.json`의 commit이 PR head와 다를 수 있습니다. PR artifact는 통합 검증용이며 일반 배포 승인이 아닙니다. 전달할 후보는 `main` 또는 명시적으로 선택한 ref의 전체 workflow 성공과 commit을 확인한 뒤 선택하세요. fork PR은 저장소 정책에 따라 실행 승인 대기가 생길 수 있고, 충돌한 PR은 충돌을 해결해야 검증됩니다. [GitHub PR 이벤트 규칙](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)을 참고하세요.

GitHub의 PR 검사 또는 Actions 화면에서 **build**와 **clean-smoke**가 모두 성공했는지 확인합니다. CLI로 `main` 실행 목록을 조회할 수도 있습니다.

```sh
gh run list --workflow windows-preview.yml --branch main
gh run view <실행-ID>
```

실패한 job의 로그에서 의존성 설치·source 검사·테스트·패키징·독립 smoke 중 어느 단계가 실패했는지 먼저 확인하세요. 실패·취소·승인 대기 결과를 성공한 후보로 사용하지 않습니다. 수동 실행·재실행도 runner 사용량을 늘리므로 오류 원인을 확인한 뒤 필요한 실행만 요청하세요.
