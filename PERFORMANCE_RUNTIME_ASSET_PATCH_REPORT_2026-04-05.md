# 이미지 성능 아키텍처 패치 보고서

## 이번 패치의 목표
이미지를 슬롯에 넣는 순간 프로그램이 급격히 무거워지는 핵심 원인인
`data URL -> HTML 문자열 비대화 -> history/autosave/localStorage 부담` 경로를 끊고,
편집 중에는 가벼운 preview blob URL, 저장 시에는 linked 자산, 복구 시에는 stable asset ref를 쓰는 방향으로 전환했습니다.

## 실제로 바뀐 것

### 1) 편집 중 이미지 삽입 경로 변경
- 기존: `applyFileToSlot()`에서 `readFileAsDataUrl(file)`로 즉시 base64 문자열 생성
- 변경: `registerRuntimeAsset(file)`로 런타임 자산 등록
  - 원본 Blob 저장
  - preview Blob(다운스케일) 생성
  - 캔버스에는 preview blob URL 적용
  - export/snapshot에는 `asset:<id>/<name>` ref 유지

### 2) linked 저장 표준 강화
- linked 저장 시 runtime asset ref를 실제 `assets/...` 파일로 materialize
- embedded 저장은 여전히 지원하지만, 그때만 asset ref/blob ref를 data URL로 변환
- 저장 UI 문구도 `linked 표준 (가볍고 재편집 권장)` / `embedded 전달용 (무거울 수 있음)`으로 조정

### 3) autosave / snapshot 복구 보강
- snapshot HTML은 preview blob URL이 아니라 stable `asset:` ref를 담도록 변경
- snapshot마다 `runtimeAssetIds`를 같이 저장
- autosave 복구 / 스냅샷 복원 전에 `ensureRuntimeAssetRecords()`로 필요한 자산을 선로드
- asset resolver가 `asset:` ref를 preview URL로 다시 해석하도록 보강

### 4) 코드/자산 relink 경량화
- 깨진 자산 일괄 relink가 더 이상 data URL로 HTML을 덮지 않음
- 선택한 파일을 runtime asset으로 등록한 뒤 `asset:` ref를 코드에 치환
- safe apply/normalize 경로에서 preview URL로 해석됨

### 5) 검증 보강
추가된 검증:
- `frame_avoids_dataurl_slot_insertion`
- `runtime_asset_module_present`
- `linked_export_materializes_runtime_assets`
- `autosave_snapshot_tracks_runtime_asset_ids`

현재 검증 결과:
- `validate_phase8.py` 183 / 183 통과
- `node --check app.bundle.js` 통과

## 기대 효과
- 이미지 넣을 때 HTML 문자열이 급격히 커지지 않음
- history/autosave가 base64 문자열 덩어리를 반복 복사하지 않음
- linked 저장이 편집 표준에 더 잘 맞음
- 복구/재오픈 시에도 runtime asset id를 통해 preview가 살아남음

## 아직 남은 한계
- autosave 본문 자체는 아직 localStorage의 HTML 문자열 기반입니다.
  다만 이제 그 HTML 안에 큰 data URL이 안 들어가므로 부담이 훨씬 줄어드는 구조입니다.
- runtime asset IndexedDB 정리/청소 정책은 아직 없습니다.
- very large image 원본 Blob은 IndexedDB에 저장되므로 디스크/브라우저 저장공간 사용량은 늘 수 있습니다.
- embedded 저장은 설계상 여전히 무겁습니다. 전달용으로만 쓰는 것이 맞습니다.
- 실제 브라우저 상호작용 성능은 이 환경 정책 때문에 자동 클릭 스모크로 끝까지 측정하지 못했습니다.

## 다음으로 가장 효과 큰 후속 작업
1. autosave/project snapshot 본문도 IndexedDB로 이동
2. runtime asset GC(사용 안 하는 asset 정리)
3. section thumbnail이 preview rendition을 재사용하도록 최적화
4. 대형 diff/lint/contrast 검사 worker 추가 분리
5. embedded 저장 시 진행률/용량 경고 강화
