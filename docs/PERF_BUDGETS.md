# PERF_BUDGETS

정확한 숫자는 실브라우저 QA로 보정한다. 현재는 아래를 임시 예산으로 둔다.

## 예산 + 계측 포인트(Phase 2)

| 항목 | metric_id | 임시 예산(ms) | 계측 포인트(코드 기준) |
|---|---|---:|---|
| 이미지 삽입(단일 3~8MB) | `image_insert_apply_files_ms` | 1000 | `src/main.js`의 `replaceImageInput change` 핸들러에서 `activeEditor.applyFiles(files)` 호출 구간 |
| 섹션 썸네일 초기 생성(10개 섹션 기준) | `section_thumbnail_initial_build_ms` | 3000 | `src/main.js`의 `buildSnapshotThumbnail()` 및 첫 스냅샷 렌더 경로 |
| code diff 최초 계산(일반/긴 문서) | `code_diff_first_calc_ms` | 1000(일반), 3000(긴 문서) | `src/main.js`의 `computeCodeDiffSummary()` 최초 실행 구간 |
| iframe height stabilization | `iframe_height_stabilization_ms` | 1500 | `src/main.js`의 `syncPreviewFrameHeight()` → `schedulePreviewHeightStabilization()` 수렴 구간 |

> 긴 문서 여부는 프로브 데이터에 `scenario=long`으로 표기한다.

## 단계적 경고/실패 기준(Phase 2)

- `warn` 모드(기본):  
  - 계측 포인트 누락은 **실패**  
  - 예산 초과는 **경고**(exit code 0)
- `enforce` 모드:  
  - 계측 포인트 누락은 **실패**  
  - 예산 30% 초과(`observed_ms > budget_ms * 1.3`)는 **실패**(exit code 1)

## 금지
- 편집 기본 경로에서 HTML 전체에 data URL 즉시 삽입
- autosave에 큰 HTML 문자열 무제한 저장
