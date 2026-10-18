# Swallow 소개 사이트

공개 주소: https://nemory-dev.github.io/swallow/

HTML·CSS와 공개용 예제 앱 화면만 사용하는 정적 사이트입니다. 외부 폰트·분석 스크립트·서버·문서 업로드 기능은 사용하지 않습니다. 앱 빌드와 별도로 배포합니다.

## 로컬 확인

저장소 루트에서 실행하고 http://127.0.0.1:4173 을 엽니다.

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory website
```

작은 화면(320px·390px)과 데스크톱에서 가로 넘침, 이미지, 다운로드 링크, 설치 안내 펼치기, 키보드 포커스를 확인하세요. 앱 화면 이미지를 누르면 원본을 볼 수 있습니다.

## 수정 및 공개

- `index.html`: 소개·학습 흐름·다운로드·설치·피드백 링크.
- `styles.css`: 시스템 폰트와 반응형 스타일. 모션 감소 설정을 따릅니다.
- `assets/`: 공개용 예제 자료로 촬영한 앱 화면과 favicon. 개인 문서는 포함하지 않습니다.
- `.github/workflows/pages.yml`: main의 `website/` 또는 워크플로 변경 시 사이트 폴더만 Pages로 배포합니다. 수동 실행도 가능합니다.

저장소 Settings → Pages의 Source는 **GitHub Actions**입니다. Actions의 **Deploy Swallow website** 성공과 공개 주소를 확인하세요. 앱 소스·내부 문서·릴리스 바이너리는 사이트 아티팩트에 포함하지 않습니다.

릴리스가 바뀌면 다운로드 링크·버전·지원 조건·설치 주의사항을 함께 갱신합니다. Developer ID 서명·Apple 공증 상태는 실제 릴리스 근거에 맞게 표시해야 합니다.
