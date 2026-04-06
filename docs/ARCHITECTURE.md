# ARCHITECTURE

## 큰 구조
- `index.html` / `styles.css`: 셸과 레이아웃
- `src/main.js`: 앱 상태, 이벤트 허브, UI 연결
- `src/editor/frame-editor.js`: 캔버스/선택/크롭/섹션/저장 핵심
- `src/core/runtime-assets.js`: runtime asset registry
- `src/core/project-store.js`: 프로젝트/저장 계층
- `scripts/build_local_bundle.py`: 번들 생성
- `scripts/validate_phase8.py`: 회귀 검증

## 현재 중요한 아키텍처 원칙
- 편집 중 이미지는 runtime asset registry에서 관리
- linked 기본 저장
- diff/lint/safe apply는 HTML-first 흐름을 지원
- 성능 민감 작업은 가능한 경우 worker 또는 lazy 계산
