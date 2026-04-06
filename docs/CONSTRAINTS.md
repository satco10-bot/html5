# CONSTRAINTS

## 실행 환경
- `file://` 직접 실행 유지
- 초기 부팅에 서버, HTTPS, 원격 API 필수 의존 금지
- File System Access API는 선택 경로만 허용

## 저장/자산
- 편집 중 `data URL` 기본 금지
- 편집 표준은 `runtime asset registry + blob/object URL`
- 기본 저장은 `linked`
- `embedded`는 전달용 예외

## 호환성
- `uploaded:` 경로, 상대경로, placeholder 슬롯 회귀 금지
- fixture 05 회귀 금지

## UX
- 캔버스가 화면의 주인공이어야 함
- 고급 기능은 기본 편집 흐름을 침범하지 말 것
