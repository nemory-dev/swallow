# PDF 테스트 자료

이 저장소를 위해 직접 생성한 합성 자료이며 개인정보·계정 데이터가 없습니다.

- diagram.pdf: 2쪽 텍스트와 벡터 화살표 도식(A → B).
- long.pdf: 30쪽 텍스트. 페이지별 긴 본문 분할과 마지막 페이지 렌더링 확인.
- scan.pdf: 텍스트 레이어가 없는 래스터 스캔. 한국어·영어 Vision OCR 확인.
- encrypted.pdf: diagram.pdf의 암호화 사본. 테스트 암호 `test-password`이며 가져오기 거부 확인.
- too-many-pages.pdf: 301쪽. 페이지 수 제한 확인.
- owner-encrypted.pdf: 사용자 암호 없이 열리지만 소유자 암호로 암호화한 사본. 두 PDF 엔진 모두 가져오기 거부 확인.
- rotated.pdf: diagram.pdf 첫 쪽의 90도 회전 사본. 렌더 비율 확인.
- blank.pdf: 빈 1쪽. 원본 페이지 위치 유지 확인.

재생성: macOS에서 reportlab, pypdf, Pillow가 설치된 Python으로 `python3 scripts/generate-pdf-fixtures.py`를 실행합니다. 이는 테스트 자료 생성 도구이며 앱 실행 의존성이 아닙니다. 스캔은 시스템 Arial·Apple SD Gothic Neo 폰트를 사용합니다.

실제 구독 모델의 그림 해석 정확도를 검증한 자료라고 간주하지 않습니다. 자동 AI 검증은 이미지/본문 전달 계약, 근거 페이지, 저장 및 실패 복구를 대역 응답으로 확인합니다.
