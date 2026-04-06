# STATUS

## 현재 기준
- linked 기본 저장, runtime asset registry, HTML-first 왕복, diff/lint/safe apply, section/crop 개선까지 들어간 상태다.
- 가장 큰 리스크는 성능과 장기 유지보수 drift다.

## 당장 다음 작업
- runtime assets phase 2
- UI density phase 1
- HTML specialization phase 1

## 마지막 업데이트 규칙
각 Codex 작업이 끝나면 아래를 갱신한다.
- 무엇을 했는지
- 어떤 검증을 돌렸는지
- 남은 리스크가 뭔지

## 2026-04-06 업데이트
- `docs/CONSTRAINTS.md`의 "초기 부팅에 서버/HTTPS/원격 API 필수 의존 금지"를 기계적으로 점검하는 `scripts/check_remote_dependency_gate.py`를 추가했다.
- 스캔 범위는 `src/main.js`, `src/editor/**/*.js`, `src/core/**/*.js`이며, 원격 호출 토큰(`fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest`)을 수집하고 선택 기능/필수(또는 미분류)로 분류한다.
- 현재 발견된 호출은 `src/editor/frame-editor.js`의 blob/data/runtime-asset 변환용 `fetch` 3건이며 선택 기능으로 분류된다.
- `scripts/validate_phase8.py`에 원격 의존 게이트를 연결해 필수/미분류 원격 의존이 발견되면 validate를 실패 처리하도록 했다.
- `scripts/run_harness_gate.py` 명령 흐름에도 원격 의존 게이트를 추가했다.

### 이번 작업 검증
- `python3 scripts/build_local_bundle.py`
- `node --check app.bundle.js`
- `python3 scripts/check_remote_dependency_gate.py`
- `python3 scripts/validate_phase8.py`
- `python3 scripts/run_harness_gate.py`

### 남은 리스크
- 원격 호출 분류는 현재 허용 목록 기반(정적 규칙)이라, 새로운 원격 API 사용이 추가되면 허용 목록/분류 규칙을 같이 갱신해야 한다.

## 2026-04-06 추가 업데이트 (런타임 오버레이 직렬화 가드)
- `src/core/runtime-overlay.js`를 추가해 런타임 오버레이 DOM 식별자(`data-editor-overlay`, `data-editor-runtime`, `__phase5_local_editor_overlay`)를 공통 정의했다.
- `src/editor/frame-editor.js`의 인터랙션/크롭 오버레이 생성 경로를 위 식별자로 통일하고, 저장 직전 직렬화 단계에서 `removeRuntimeOverlayNodes()`로 오버레이 제거를 공통 처리하도록 정리했다.
- `src/core/normalize-project.js` 시작 단계에서도 동일한 오버레이 제거 로직을 적용해 normalize 결과에 런타임 오버레이가 섞이지 않도록 보강했다.
- `scripts/validate_phase8.py`에 fixture_05 오버레이 혼입 회귀 체크(`F05_has_no_runtime_overlay_tokens`)를 추가했다.
- 오버레이/라인 이동으로 바뀐 `fetch` 위치를 반영하도록 `scripts/check_remote_dependency_gate.py`의 optional line 허용 목록을 갱신했다.

### 이번 작업 검증
- `python3 scripts/build_local_bundle.py`
- `node --check app.bundle.js`
- `python3 scripts/check_remote_dependency_gate.py`
- `python3 scripts/validate_phase8.py`
- `python3 scripts/run_harness_gate.py`

### 남은 리스크
- 원격 의존 게이트의 optional 분류가 line number 기반이라, 관련 코드 이동 시 허용 목록 업데이트를 놓치면 validate가 실패할 수 있다.
