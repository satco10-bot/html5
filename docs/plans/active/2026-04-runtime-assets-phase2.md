# Goal
runtime asset 기반 성능 문제를 더 줄인다.

## Scope
- autosave/project snapshot의 IndexedDB 1차 이전
- runtime asset GC
- preview/original/thumb 3단 구조의 최소 구현
- perf validator 추가 (`scripts/validate_perf_budgets.py`, `warn/enforce` 단계 도입)

## Non-goals
- 대규모 UI 리디자인
- market lint / safe apply 확장

## Constraints
- file:// 유지
- linked 기본 저장 유지
- data URL 편집 기본 경로 금지
- fixture_05 회귀 금지

## Acceptance
- 큰 이미지 삽입 후 UI 응답이 개선된다.
- runtime asset 정리 경로가 생긴다.
- build/validate/harness gate 통과

## Validation
- python3 scripts/build_local_bundle.py
- node --check app.bundle.js
- python3 scripts/validate_perf_budgets.py
- python3 scripts/validate_phase8.py
- python3 scripts/run_harness_gate.py
