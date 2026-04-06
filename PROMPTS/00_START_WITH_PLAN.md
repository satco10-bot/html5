먼저 `/plan` 으로 시작해줘.

이 저장소는 로컬 `file://` 실행을 유지하는 HTML 기반 상세페이지 편집기다.
반드시 아래 파일을 source of truth로 삼아라.
- AGENTS.md
- docs/SPEC.md
- docs/CONSTRAINTS.md
- docs/ARCHITECTURE.md
- docs/PERF_BUDGETS.md
- docs/STATUS.md
- docs/plans/active/*.md 중 내가 지정하는 파일

작업 방식:
1. 읽은 범위를 10줄 이내로 요약
2. 이번 작업 범위 밖은 건드리지 말 것
3. 수정 후 아래를 반드시 실행
   - python3 scripts/build_local_bundle.py
   - node --check app.bundle.js
   - python3 scripts/validate_phase8.py
   - python3 scripts/run_harness_gate.py
4. 결과를 docs/STATUS.md와 필요시 docs/KNOWN_ISSUES.md / docs/DECISIONS.md에 반영
5. 변경 파일 / 검증 결과 / 남은 리스크를 보고
