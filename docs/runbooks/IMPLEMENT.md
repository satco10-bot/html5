# IMPLEMENT RUNBOOK

## Codex 작업 순서
1. `AGENTS.md`와 현재 `docs/plans/active/*.md` 읽기
2. 범위 요약 쓰기
3. 수정
4. `python3 scripts/build_local_bundle.py`
5. `node --check app.bundle.js`
6. `python3 scripts/validate_phase8.py`
7. `python3 scripts/run_harness_gate.py`
8. `docs/STATUS.md`, 필요시 `KNOWN_ISSUES.md`, `DECISIONS.md` 갱신

## Stop-and-fix rule
검증 실패가 있으면 새 기능 추가보다 먼저 검증 실패를 복구한다.
