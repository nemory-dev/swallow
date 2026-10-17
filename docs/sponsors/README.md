# Swallow 일회성 후원 설정 준비

확인일: 2026-10-17. 대상: GitHub 개인 계정 `nemory-dev`의 한국 거주 개인 운영 시나리오. 사업자등록 없이 시작할 수 있는지는 아래 세무 확인 절차에서 판단한다. 이 문서는 공개된 운영자용 준비 안내이며 가입·서류 제출·결제 활성화를 수행하지 않는다.

## 지금 준비된 범위

- 사용자 안내: [저장소 루트 README의 「일회성 후원 준비」](../../README.md#일회성-후원-준비).
- 가입 화면에 붙여 넣을 소개·등급 문구: 아래 제공.
- 저장소 후원 버튼 초안: [FUNDING.yml.example](FUNDING.yml.example). 활성 경로인 `.github/FUNDING.yml`은 만들지 않았다.
- 기록 양식: [sponsorship-ledger.csv.example](sponsorship-ledger.csv.example). 실제 후원자·거래·금융정보는 저장소 밖 비공개 위치에서 관리한다.
- 읽기 전용 GitHub API 확인 결과, 아직 Sponsors 프로필이 없다(`hasSponsorsListing: false`).

## 운영 원칙과 확인되지 않은 제한

Swallow의 모든 기능은 계속 무료다. 프로젝트가 제공하는 후원자 전용 기능, 먼저 받는 버전, 우선 기술지원, 개발 일정 보장, 광고, 이름·로고 게재는 없다. 월 정기 후원 등급을 만들지 않고 일회성 등급만 준비한다. GitHub 자체 배지 등 플랫폼 표시를 프로젝트의 제공 혜택으로 약속하지 않는다.

**현재는 접수를 시작하지 않는다.** GitHub 공식 문서는 맞춤 금액 후원이 기본 활성화되며 최소 금액이 정기·일회성에 함께 적용된다고 안내한다. 월 등급을 만들지 않거나 일회성 링크로 유도하는 것만으로 정기 결제가 완전히 차단된다고 보장할 수 없다. 가입 후 실제 화면 또는 GitHub Support에서 일회성만 허용할 수 있는지 확인하기 전에는 후원 버튼·등급을 공개하지 않는다. 해당 조건을 충족할 수 없다면 접수는 보류한다.

원화 누적 50만 원 미만에서 자동으로 접수를 차단하는 기능은 확인하지 못했다. 목표 금액 표시, 최소 후원액, 일회성 등급은 누적 수령 한도가 아니다. 동시에 발생하는 결제·맞춤 금액·환율 변화로 수동 관리만으로는 상한을 보장할 수 없다. **50만 원 미만 유지가 반드시 보장되어야 한다면, 그 기능을 확인할 때까지 결제를 열지 않는다.**

근거: [등급 관리](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/managing-your-sponsorship-tiers), [맞춤 금액 기본 활성화 안내](https://github.blog/changelog/2022-09-13-github-sponsors-change-notice-for-the-custom-amount-setting/).

## 직접 진행할 가입·입력 절차

1. [GitHub Sponsors 시작](https://github.com/sponsors)에서 `nemory-dev`로 로그인하고 **Get sponsored**를 선택한다. 한국 개인의 실제 거주·본인 정보로 진행한다. GitHub 2단계 인증을 준비한다.
2. 개인 계정의 소개와 Featured work에 Swallow를 지정한다. 아래 문구를 사용하고, Featured Sponsors의 자동 이름·로고 노출은 사용하지 않는다.
3. 지급 설정은 개인의 실제 정보와 한국 은행계좌로 직접 입력한다. 거주국과 은행 소재국을 맞춘다. Stripe가 요구하는 본인확인·계좌확인을 완료한다. 사업자번호나 사업자 서류를 요구하는 화면이 나오면 번호를 만들어 넣지 말고, 개인 수령 경로를 GitHub/Stripe에 확인한다.
4. 세금 입력은 미국 세법상 미국인이 아닌 개인이라면 안내되는 **W-8BEN** 경로를 확인한다. 회사용 W-8BEN-E와 혼동하지 않는다. 세법상 거주국·납세자 식별정보·전자서명은 공식 화면에서 직접 입력한다. 조세조약 혜택이나 소득 종류·세율을 임의로 고르지 않는다. 모르면 제공자 지원 또는 세무 상담을 이용한다.
5. **Sponsor tiers → One-time tiers → Add a one-time tier**에서 등급 하나만 초안으로 만든다. 제안 금액은 USD 1이며 실제 허용 최소 금액을 화면에서 확인한다. 자동 제안된 월 등급은 공개하지 않는다. 환율에 따라 원화 금액은 달라진다.
6. **Save draft** 상태에서 아래 공개 전 확인을 마친다. **Request approval**은 승인 후 프로필이 자동 공개될 수 있으므로, 조건 확인과 가입 약관·세금 서류의 본인 검토가 끝난 다음 직접 진행한다. 등급의 **Publish tier**와 프로필 심사 요청을 모두 공개 단계로 취급한다.

실명·주소·생년월일·납세자번호·계좌번호·신분증·세금 양식은 채팅, Git 저장소, 이 폴더에 저장하지 않는다. 본인확인·세금 서류는 소액이라는 이유로 생략하거나 허위 입력하지 않는다.

사업자등록을 이 준비의 공통 선행 조건으로 추가하지 않았다. 등록이 필요한지는 국내 세무 확인 결과에 따르고, 필요하지 않은 등록을 대신 신청하지 않는다.

근거: [개인 가입 절차](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/setting-up-github-sponsors-for-your-personal-account), [세금 정보](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/tax-information-for-github-sponsors), [프로필 표시 설정](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/editing-your-profile-details-for-github-sponsors).

## 붙여 넣을 문구

Short bio:

> 무료 오픈소스 학습 앱 Swallow를 개발합니다. 일회성 자율 후원을 준비하고 있으며 후원자 전용 혜택은 없습니다.

Introduction:

> 안녕하세요, nemory입니다. 원문을 읽고 자신의 말로 답하며 요점노트를 남기는 무료 오픈소스 앱 Swallow를 개발합니다.
>
> Swallow는 후원 여부와 관계없이 모든 기능을 계속 무료로 제공합니다. 후원은 개인 개발과 유지보수를 응원하는 선택적인 일회성 지원입니다. 후원자 전용 기능, 선행 배포, 우선 지원, 광고, 이름·로고 게재는 제공하지 않으며 특정 기능 개발이나 완료 시점을 약속하지 않습니다.
>
> 현재는 후원 접수를 준비하고 있습니다. 일회성 결제 조건을 확인한 뒤 접수를 안내하겠습니다. 앱 사용을 위해 후원할 필요는 없습니다.

일회성 등급 설명 초안:

> Swallow 일회성 응원
>
> 한 번만 보내는 자율 후원입니다. Swallow의 모든 기능은 누구에게나 계속 무료이며, 후원자 전용 혜택이나 특정 개발·지원 약속은 없습니다. 정기 결제는 받지 않습니다.

등급 문구는 실제 결제 화면에서 일회성이 확인된 경우에만 공개한다. 프로필을 최종 공개할 때에는 위 소개의 마지막 문단을 실제 접수 상태에 맞춰 갱신한다. 환불 불가나 세액공제를 약속하는 문구는 추가하지 않는다.

## 공개 전에 확인할 최소 항목

- 일회성 결제만 가능한가? 월·연 정기 결제 또는 맞춤 금액 정기 결제가 남으면 공개하지 않는다. 실제 결제를 완료할 필요 없이 설정과 결제 확인 화면까지 살펴본다.
- 누적 한도가 필수라면 제공자가 그 조건을 보장하는가? 보장되지 않으면 접수를 보류한다.
- 개인 지급 계정·필수 세금 서류·2FA가 준비됐는가? 가입 승인과 약관 동의는 본인이 한다.
- 사업자등록·세금 신고의 필요 여부를 실제 운영 조건으로 확인했는가? 필요하지 않다고 확인되면 불필요한 등록을 추가하지 않고, 필요한 절차는 금액을 쪼개거나 명목을 바꿔 생략하지 않는다.
- 활성 후원 버튼·README 링크를 추가하기 전에 Sponsors 프로필과 결제 화면이 올바른 계정·일회성 조건을 가리키는가?

확인 후에만 `FUNDING.yml.example`을 `.github/FUNDING.yml`로 적용하는 변경을 별도로 검토한다. 이 파일은 후원 프로필 링크만 제공하며 결제 주기·금액을 제한하지 않는다. 준비 문서를 커밋·공개해도 실제 후원 접수는 활성화되지 않는다. 후원 접수 활성화는 운영자의 별도 결정과 설정 변경이 필요하다.

## 50만 원 미만 운영과 최소 기록

50만 원은 이번 준비에서 **초기 운영 기간 전체의 누적 후원 총액을 작게 유지하려는 개인적 목표**로 해석한다. 연간 면세 한도나 신고 면제선으로 안내하지 않는다. 순수 증여로 판단된 경우의 증여세 과세표준 50만 원 미만 규정은 개발 활동에 따른 사업수입에 그대로 적용되지 않는다. 원화 입금액·수수료 공제 후 금액만 보고 판단하지 않는다. [상속세 및 증여세법 제55조](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900417945)

접수를 열 수 있는 조건이 확인되면 양식을 저장소 밖으로 복사하고, 결제 통지마다 CSV에 날짜·거래 식별자·외화 총액·수수료·정산액·원화 환산 기준·환불을 기록한다. 은행에 아직 지급되지 않은 후원도 기록하고, 세무상 수입 시기와 환산 방법은 확인한 기준을 따른다. 기록 파일의 실제 데이터는 공개 저장소 밖에 보관한다.

후원 접수를 중단할 때 README나 Sponsor 버튼만 지워서는 직접 프로필 방문을 막을 수 없다. GitHub는 후원자가 없는 경우 직접 프로필 비공개가 가능하지만, 후원자가 있다면 Support에 요청하도록 안내한다. 따라서 수동 중단도 즉시 완료되거나 상한을 지킨다고 보장하지 않는다. [프로필 비공개 안내](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/unpublishing-your-github-sponsors-profile)

## 한 번에 물어볼 질문

국세청 126 또는 세무 상담:

> 한국 거주 개인이며 사업자가 없습니다. 무료 오픈소스 앱을 계속 무료로 제공하고 기능·지원·광고 등의 대가 없는 소액 일회성 후원만 GitHub Sponsors로 받을 예정입니다. 정기 후원은 받지 않을 계획입니다. 예상 총액은 50만 원 미만이지만 이를 세법상 면제 한도라고 가정하지 않습니다. 사업자등록이 필요한지, 후원금의 과세 유형과 부가가치세 여부, 신고가 필요하지 않은 경우의 조건 및 외화 수입 기록 기준을 확인하고 싶습니다.

일반 상담에서 구체적 판단이 어렵다면 [국세청 서면질의·사전답변 안내](https://nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=109145&mi=13367)를 확인한다. 세무상 필요하지 않은 절차를 줄이는 것과 필수 의무를 생략하는 것은 구분한다. GitHub 서류 제출이 국내 신고를 대신하지 않는다.

GitHub Support 문의 초안(필요할 때 본인이 전송):

> I am preparing GitHub Sponsors for my personal account, nemory-dev. I only want to accept small one-time contributions, without rewards. Before publishing, can I completely disable recurring sponsorships, including custom monthly amounts? Is there an enforceable cumulative receiving cap? If not, how can I stop accepting new contributions promptly after receiving my first one-time sponsorship? I have not enabled receiving payments yet.

임의의 세율·업종·소득 구분을 정하거나 가입 정보를 제출하지 않았다. 실제 조건 확인 전에는 일회성 전용 또는 누적 한도 강제가 완료됐다고 표현하지 않는다.
