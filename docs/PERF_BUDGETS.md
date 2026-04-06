# PERF_BUDGETS

정확한 숫자는 실브라우저 QA로 보정한다. 현재는 아래를 임시 예산으로 둔다.

## 예산
- 단일 3~8MB 이미지 삽입 후 UI 멈춤: 체감 1초 이내 목표
- 10개 섹션 문서에서 section thumbnail 초기 생성: 체감 3초 이내 목표
- code diff 최초 계산: 일반 문서 1초 내, 긴 문서 3초 내 목표
- iframe height stabilization: 1.5초 이내 수렴 목표

## 금지
- 편집 기본 경로에서 HTML 전체에 data URL 즉시 삽입
- autosave에 큰 HTML 문자열 무제한 저장
