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

## 2026-04-06 추가 업데이트 (perf validator)
- `docs/PERF_BUDGETS.md`에 이미지 삽입/썸네일/diff/iframe 안정화 4개 항목을 `metric_id + 예산(ms) + 계측 포인트` 형태로 명시했다.
- `scripts/validate_perf_budgets.py`를 추가해 계측 포인트(코드 anchor) 존재 여부를 검사하고, 프로브 결과(`evals/reports/PERF_PROBES.json` 또는 `reports/PERF_PROBES.json`)를 예산과 비교하도록 했다.
- 단계적 기준을 도입했다: `PERF_BUDGET_MODE=warn`(기본)은 초과를 경고로 처리, `PERF_BUDGET_MODE=enforce`는 예산 30% 초과를 실패로 처리한다. 계측 포인트 누락은 두 모드 모두 실패다.
- `scripts/run_harness_gate.py` 명령 흐름에 perf validator를 추가했고, `reports/PERF_VALIDATOR_RESULTS.json` 요약을 gate 결과 JSON에 수집한다.

### 이번 작업 검증
- `python3 scripts/build_local_bundle.py`
- `node --check app.bundle.js`
- `python3 scripts/validate_perf_budgets.py`
- `python3 scripts/validate_phase8.py`
- `python3 scripts/run_harness_gate.py`

### 남은 리스크
- 현재 저장소에는 성능 프로브 샘플 파일이 기본 포함되어 있지 않아, 실제 수치 판정은 경고 위주(`missing`)로 남을 수 있다. QA/하네스에서 `PERF_PROBES.json` 생성 경로를 정착시켜야 enforce 모드의 효용이 커진다.
