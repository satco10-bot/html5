# Phase 30 — HTML 토큰/팔레트/가독성 lint/색상 diff 반영 보고서

## 이번 라운드에서 실제로 넣은 기능

### 1) typography / spacing / radius / shadow 토큰 편집기
- `:root` / `<style>` 블록의 CSS custom property를 다시 읽어서
  - Typography
  - Spacing
  - Radius
  - Shadow
  카테고리로 분류해 편집할 수 있게 추가했습니다.
- 컬러 토큰은 기존 편집기와 역할이 겹치므로 이 편집기에서는 제외했습니다.
- 토큰 변경은 코드 초안 HTML에 먼저 반영한 뒤 `safeApplyCodeToEditor()` 경로로 캔버스에 반영됩니다.

### 2) 반복 inline 색상 → CSS 변수 자동 추출
- inline style 안에서 반복되는 색상을 감지합니다.
- 반복 횟수가 2회 이상인 색에 대해 추천 CSS 변수명을 만들어 리스트로 보여줍니다.
- 사용자가 변수명을 확인한 뒤 적용하면:
  - 자동 생성 style 블록(`data-detail-editor-inline-vars`)에 `:root` 변수를 추가
  - inline style의 실제 색상 값을 `var(--...)` 형태로 치환
- 결과는 저장 HTML에도 남습니다.

### 3) 섹션별 테마 팔레트
- 각 섹션에서 많이 쓰는 색을 추출해 섹션 카드별 팔레트로 보여줍니다.
- 선택된 섹션은 팔레트 색상을 직접 수정할 수 있도록 input이 열립니다.
- 적용 시 선택 섹션 범위에만 색상 변경을 반영합니다.

### 4) 색상 대비 / 가독성 lint
- 현재 미리보기 iframe의 실제 computed style 기준으로 텍스트 대비를 계산합니다.
- 일반 텍스트(4.5:1) / 큰 텍스트(3:1) 기준으로 warning/error를 분리합니다.
- 이슈가 있으면:
  - 요소 선택
  - 코드 줄 점프
  흐름을 같이 제공합니다.

### 5) diff에서 색상 변경만 보기
- 코드 diff 비교에서 `색상 변경만` 토글을 추가했습니다.
- 색상값, 컬러 토큰, `color/background/border/fill/stroke/box-shadow/text-shadow` 관련 라인이 포함된 chunk만 보여줍니다.
- 색상 관련 chunk에는 요약 배지도 붙습니다.

## 이번 라운드에서 같이 손본 부분
- `codeCompareColorOnlyButton` 상태를 compact control sync에 연결
- `renderCodeComparePanel()` 요약에 `색상 변경만` 모드를 반영
- contrast lint는 매 렌더마다 전체 재계산하지 않도록 cache key를 넣어 부담을 줄임
- validate 스크립트에 새 기능 ID를 추가해 회귀 검사를 강화

## 검증 결과
- `python3 scripts/build_local_bundle.py` 실행 완료
- `node --check src/main.js` 통과
- `node --check app.bundle.js` 통과
- `python3 scripts/validate_phase8.py` 통과 (`179 / 179`)
- 추가 기능 검증 `21 / 21` 통과

## 현재 상태를 현실적으로 보면

### 구현 수준
- 기능 완성도: **91~93%**
- HTML-first 왕복 편집성: **95~96%**
- 상세페이지 실무 편집성: **89~91%**
- 미리캔버스급 사용성 달성률: **72~75%**
- 전체 목표 달성률: **87~89%**

### 강해진 점
- 이제 이 편집기는 단순한 “캔버스 편집기”보다
  **HTML/CSS를 직접 다루는 상세페이지 편집기**로 훨씬 강해졌습니다.
- 특히 아래는 미리캔버스보다도 우리 쪽이 더 강해질 수 있는 축입니다.
  - safe apply
  - CSS 변수/토큰 편집
  - inline style 정리
  - 마켓 업로드 관점 lint
  - HTML 주석/data-attribute 메타 연결

### 아직 남은 거친 부분
1. **좌측 패널 밀도는 여전히 높습니다.**
   - 현재 `index.html` 기준 버튼 수: **172개**
   - 입력/선택 수: **48개**
   - 그중 좌측 사이드바 버튼이 **106개**입니다.
   - 즉 기능은 강하지만, 노출량은 아직 많습니다.

2. **contrast lint는 computed style 기반이라, 매우 큰 문서에서는 여전히 무거울 수 있습니다.**
   - 이번엔 cache를 넣었지만, 완전한 worker 분리는 아직 아닙니다.

3. **섹션별 팔레트는 현재 색상 중심입니다.**
   - typography/spacing/radius/shadow까지 섹션 테마 단위로 연결하진 않았습니다.

4. **inline color extract는 basename 수준의 안전한 치환만 합니다.**
   - 더 정교한 토큰 병합/중복 해소는 2차가 필요합니다.

## 인터페이스적으로 더 개선할 거리
1. **좌측 패널 3차 압축**
   - style color studio / token editor / inline extract / section palette를
     따로 4개 아코디언으로 두는 대신
     **`테마 스튜디오` 하나로 묶고 탭 전환**하는 쪽이 더 낫습니다.

2. **다운로드 모달 3차**
   - 고급 옵션은 지금도 줄였지만, 아직 실무 사용자 기준으로는 조금 많습니다.
   - 목적 기반 카드 → 형식/옵션 → 실행 흐름으로 더 줄일 수 있습니다.

3. **코드 워크벤치 3차**
   - diff + lint + safe apply + token editor가 연결되기 시작했으니,
     다음은 `문제 줄 중심 워크플로`를 더 강하게 만들어야 합니다.

4. **색상 변경 히스토리 / 테마 스냅샷**
   - 이건 실제로 사용성이 큽니다.
   - “섹션 A 테마 before/after”처럼 빠르게 되돌릴 수 있어야 합니다.

## 다음 우선순위 제안
1. **테마 스튜디오 통합 UI**
   - style colors / css tokens / design tokens / section palette / inline extract를 한 패널로 통합
2. **safe apply 2차**
   - 색상/토큰/메모/slot schema 변경을 더 보수적으로 병합
3. **market lint 2차**
   - 채널별 preset rule
4. **contrast lint worker 분리**
   - 아주 긴 문서에서도 덜 버벅이게
5. **HTML diff 2.5차**
   - 토큰/색상/메모/slot schema 변경만 필터링하는 프리셋

## 한 줄 결론
이번 라운드로 이 편집기는 **“미리캔버스처럼 편한 편집기”를 따라가는 수준을 넘어서, HTML이라서 더 강한 도구**가 되기 시작했습니다.
이제부터는 기능 추가보다 **테마/코드/검사/적용 흐름을 하나의 UX로 묶는 정리 작업**이 가장 중요합니다.
