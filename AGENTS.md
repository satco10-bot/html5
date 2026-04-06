# AGENTS.md

이 저장소는 **로컬 `file://` 실행을 유지하는 HTML 기반 상세페이지 편집기**입니다.
이 파일은 짧은 지도이고, 자세한 내용은 `docs/`가 소스 오브 트루스입니다.

## 먼저 읽을 문서
1. `docs/SPEC.md`
2. `docs/CONSTRAINTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PERF_BUDGETS.md`
5. `docs/STATUS.md`
6. 현재 작업이면 `docs/plans/active/*.md`

## 절대 깨면 안 되는 것
- `file://` 직접 실행
- `linked` 저장이 기본, `embedded`는 예외
- 편집 중 `data URL` 기본 금지
- `uploaded:` / 상대경로 / placeholder 슬롯 회귀 금지
- `data/fixtures/fixture_05_user_melting_cheese_compact.html` 회귀 금지
- 런타임 오버레이가 저장/normalize/export 결과에 섞이면 안 됨

## 작업 원칙
- 큰 작업을 한 번에 하지 말고 `docs/plans/active/*.md` 1개 기준으로만 작업
- 범위를 벗어나는 리팩터링 금지
- 변경 후 build + validate + 관련 eval을 반드시 실행
- 실패가 나오면 새 기능 추가보다 먼저 실패를 복구
- 완료 후 `docs/STATUS.md`, 필요시 `docs/KNOWN_ISSUES.md`, `docs/DECISIONS.md` 업데이트

## 필수 검증
- `python3 scripts/build_local_bundle.py`
- `node --check app.bundle.js`
- `python3 scripts/validate_phase8.py`
- `python3 scripts/run_harness_gate.py`

## 성능 민감 구간
- 이미지 삽입 / runtime asset registry
- autosave / snapshot
- diff 계산 / worker fallback
- section thumbnail 생성
- iframe height sync
