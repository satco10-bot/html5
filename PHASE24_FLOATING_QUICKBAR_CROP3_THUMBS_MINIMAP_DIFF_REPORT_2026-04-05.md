# Phase 24 — 플로팅 퀵바 2차 · 크롭 HUD 3차 · 섹션 썸네일/미니맵/코드 diff 결합

## 이번에 실제로 반영한 것

### 1) 플로팅 퀵바 2차 압축
- 캔버스 퀵바를 `복제 / 삭제 / 핵심 컨텍스트 버튼` 중심으로 줄였습니다.
- 이미지/텍스트/다중선택의 핵심 액션만 전면 배치했습니다.
- 덜 자주 쓰는 액션은 `···` 오버플로 메뉴로 보냈습니다.
- 크롭 활성 중에는 일반 퀵바를 숨기고, 크롭 전용 HUD만 보이게 정리했습니다.

### 2) 크롭 HUD 3차 시각화
- floating chip에 상태 2줄 표시를 넣었습니다.
  - 1줄: 모드/적용/취소 안내
  - 2줄: 줌 %, X/Y 오프셋, 팬/줌 조작 힌트
- 하단 크롭 컨트롤 스트립에 잠금 배지를 추가했습니다.
- 잠금 상태일 때 스트립 시각 상태를 더 강하게 바꿨습니다.
- 줌 슬라이더에 현재 값 비율을 배경으로 시각화했습니다.
- `cropOffsetX / cropOffsetY`를 editor meta로 노출해서 HUD가 실제 상태를 반영합니다.

### 3) 섹션 썸네일을 더 실제 스크린샷형으로 고도화
- 기존 DOM clone fallback은 유지하되,
- `activeEditor.exportSectionThumbnailBlob(uid, { maxWidth, maxHeight })`를 새로 추가해서
  실제 섹션을 저해상도 PNG로 렌더링한 뒤 카드 썸네일에 붙이도록 바꿨습니다.
- 썸네일은 `uid:modelVersion` 기준으로 캐싱합니다.
- 캐시가 없을 때는 즉시 fallback clone을 보여 주고, 이후 PNG 썸네일로 교체합니다.
- 다수 섹션일 때 과하게 무거워지지 않도록 썸네일 생성은 순차 실행합니다.

### 4) 미니맵 성능/하이라이트 강화
- 미니맵 track를 매번 통째로 다시 그리지 않고,
  섹션 구조 시그니처(`uid:height`)가 바뀔 때만 재구성하게 했습니다.
- 스크롤 중에는 `requestAnimationFrame` 기반으로 동기화합니다.
- 현재 선택 섹션뿐 아니라, 현재 뷰포트 중심에 있는 섹션을 `is-current`로 별도 하이라이트합니다.
- 미니맵 마커 클릭은 기존처럼 섹션으로 이동하고,
  빈 트랙을 클릭하면 해당 위치로 문서 스크롤이 이동합니다.

### 5) 코드 diff와 검사 결과 결합 강화
- 검사 결과 항목에 `비교 보기` 버튼을 추가했습니다.
- 이 버튼은 이슈 종류에 따라 추천 diff 프리셋을 자동 적용합니다.
  - 구조/정규화 성격 이슈 → `편집본 ↔ 정규화`
  - placeholder/uploaded/script/iframe 계열 → `편집본 ↔ 원본`
  - 기본 → `초안 ↔ 현재 보기`
- diff chunk가 검사 결과 라인과 겹치면 `검사 연결 N개` 배지를 띄우고 기본 펼침 처리합니다.
- 즉, 검수 리스트와 diff 패널이 따로 노는 느낌을 줄였습니다.

## 구현 메모
- `src/editor/frame-editor.js`
  - `cropOffsetX/Y` meta 추가
  - `exportSectionThumbnailBlob()` 추가
- `src/main.js`
  - quickbar 오버플로 메뉴 반영
  - minimap 구조 시그니처/현재 섹션 하이라이트
  - section preview PNG 캐시 + 순차 렌더링
  - code validation ↔ diff preset / chunk linking
- `index.html`
  - compact quickbar + quickbar more
  - crop floating meta / crop lock badge
- `styles.css`
  - quickbar more menu
  - crop HUD 3차 시각 스타일
  - minimap current marker
  - screenshot-like section thumbnail image 스타일

## 검증
- `python3 scripts/build_local_bundle.py`
- `node --check app.bundle.js`
- `python3 scripts/validate_phase8.py`

결과:
- 174 / 174 통과
- browser smoke는 `file://` 환경 정책 때문에 blocked → soft-skip

## 아직 남은 부분
- section screenshot 썸네일이 길고 복잡한 섹션에서 생성이 한 박자 늦을 수 있습니다.
- 크롭 HUD의 프리셋 active 상태(맞춤/채우기/100%)를 더 정확히 표시하는 4차 개선 여지가 있습니다.
- 코드 diff chunk 본문은 lazy render지만, 아주 긴 HTML에서는 비교 계산 자체를 worker로 빼는 게 다음 단계입니다.

## 다음으로 가장 효과 큰 순서
1. quickbar 3차: 상황별 4버튼 + `···`만 남기기
2. crop HUD 4차: 프리셋 active, 안전영역 그리드, 잠금 overlay 강화
3. diff worker 분리 + 긴 HTML 비교 비동기화
4. 섹션 썸네일 우클릭 미리보기 / 빠른 복제 / 빠른 삭제
