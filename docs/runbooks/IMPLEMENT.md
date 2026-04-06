# IMPLEMENT RUNBOOK

## Codex 작업 순서
1. `AGENTS.md`와 현재 `docs/plans/active/*.md` 읽기
2. 범위 요약 쓰기
3. 수정
4. `python3 scripts/build_local_bundle.py`
5. `node --check app.bundle.js`
6. `python3 scripts/validate_phase8.py`
7. `python3 scripts/run_harness_gate.py`
8. 작업 종료 체크리스트 수행(아래 필수)

## 작업 종료 체크리스트 (필수)
- [ ] `docs/STATUS.md` 업데이트 (필수)
- [ ] 리스크/결정 변경 여부 확인 템플릿 작성 결과를 PR 본문에 반영
- [ ] 변경이 있으면 `docs/KNOWN_ISSUES.md`, `docs/DECISIONS.md`를 갱신

### 리스크/결정 변경 확인 템플릿
아래 4줄을 그대로 복사해서, 작업 종료 시 매번 체크한다.

```text
[리스크 변경 확인]
- 새 리스크/완화책이 생겼는가? (예/아니오)
- 예라면 `docs/KNOWN_ISSUES.md`를 업데이트했는가? (예/아니오/해당없음)

[결정 변경 확인]
- 기존 결정이 바뀌었거나 새 결정이 필요한가? (예/아니오)
- 예라면 `docs/DECISIONS.md`를 업데이트했는가? (예/아니오/해당없음)
```

## PR 본문 템플릿 (고정 섹션)
PR 본문에는 아래 섹션을 항상 포함한다.

```md
## 무엇을 했는지
- 변경 1
- 변경 2

## 어떤 검증을 돌렸는지
- [ ] `python3 scripts/build_local_bundle.py`
- [ ] `node --check app.bundle.js`
- [ ] `python3 scripts/validate_phase8.py`
- [ ] `python3 scripts/run_harness_gate.py`

## 남은 리스크
- 리스크 1
- 리스크 2 (없으면 "없음" 명시)
```

## Stop-and-fix rule
검증 실패가 있으면 새 기능 추가보다 먼저 검증 실패를 복구한다.
