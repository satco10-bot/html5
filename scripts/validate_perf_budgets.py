from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports' / 'PERF_VALIDATOR_RESULTS.json'
METRIC_CANDIDATES = [
    ROOT / 'evals' / 'reports' / 'PERF_PROBES.json',
    ROOT / 'reports' / 'PERF_PROBES.json',
]

PERF_POINTS = [
    {
        'name': 'image_insert',
        'metric_id': 'image_insert_apply_files_ms',
        'budget_ms': 1000,
        'anchors': [
            ('src/main.js', "elements.replaceImageInput?.addEventListener('change', async (event) => {"),
            ('src/main.js', 'const applied = await activeEditor.applyFiles(files);'),
        ],
    },
    {
        'name': 'section_thumbnail',
        'metric_id': 'section_thumbnail_initial_build_ms',
        'budget_ms': 3000,
        'anchors': [
            ('src/main.js', 'function buildSnapshotThumbnail(snapshotHtml = \'\') {'),
            ('src/main.js', 'const thumbnail = buildSnapshotThumbnail(snapshot.html);'),
        ],
    },
    {
        'name': 'code_diff_default',
        'metric_id': 'code_diff_first_calc_ms',
        'budget_ms': 1000,
        'scenario': 'default',
        'anchors': [
            ('src/main.js', 'function computeCodeDiffSummary(baseSource, draftSource) {'),
        ],
    },
    {
        'name': 'code_diff_long',
        'metric_id': 'code_diff_first_calc_ms',
        'budget_ms': 3000,
        'scenario': 'long',
        'anchors': [
            ('src/main.js', 'function computeCodeDiffSummary(baseSource, draftSource) {'),
        ],
    },
    {
        'name': 'iframe_height_stabilization',
        'metric_id': 'iframe_height_stabilization_ms',
        'budget_ms': 1500,
        'anchors': [
            ('src/main.js', 'function schedulePreviewHeightStabilization(passes = 6) {'),
            ('src/main.js', 'function syncPreviewFrameHeight({ stabilize = 0 } = {}) {'),
        ],
    },
]


def read_text(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def load_metrics() -> tuple[list[dict[str, Any]], str]:
    for candidate in METRIC_CANDIDATES:
        if candidate.exists():
            try:
                payload = json.loads(candidate.read_text(encoding='utf-8'))
            except json.JSONDecodeError:
                return [], f'invalid json: {candidate.relative_to(ROOT)}'
            if isinstance(payload, list):
                return payload, str(candidate.relative_to(ROOT))
            if isinstance(payload, dict):
                rows = payload.get('metrics')
                if isinstance(rows, list):
                    return rows, str(candidate.relative_to(ROOT))
                return [], f'unsupported payload shape: {candidate.relative_to(ROOT)}'
    return [], 'missing'


def to_number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def extract_metric_ms(row: dict[str, Any]) -> float | None:
    for key in ('ms', 'duration_ms', 'value_ms'):
        value = to_number(row.get(key))
        if value is not None:
            return value
    return None


def evaluate_point(point: dict[str, Any], metrics: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    budget = float(point['budget_ms'])
    metric_id = str(point['metric_id'])
    scenario = point.get('scenario')
    selected: list[float] = []
    for row in metrics:
        if not isinstance(row, dict):
            continue
        if str(row.get('metric_id', '')) != metric_id:
            continue
        if scenario and str(row.get('scenario', 'default')) != scenario:
            continue
        ms = extract_metric_ms(row)
        if ms is not None:
            selected.append(ms)

    if not selected:
        return {
            'name': point['name'],
            'metric_id': metric_id,
            'scenario': scenario,
            'budget_ms': budget,
            'status': 'missing',
            'ok': True,
            'severity': 'warning',
            'detail': 'metric sample not found',
        }

    observed = max(selected)
    over_ratio = (observed / budget) if budget > 0 else 0
    over_budget = observed > budget
    should_fail = mode == 'enforce' and over_ratio > 1.3
    status = 'ok'
    severity = 'info'
    detail = f'observed={observed:.2f}ms, budget={budget:.2f}ms, ratio={over_ratio:.2f}'

    if over_budget and should_fail:
        status = 'fail'
        severity = 'error'
    elif over_budget:
        status = 'warn'
        severity = 'warning'

    return {
        'name': point['name'],
        'metric_id': metric_id,
        'scenario': scenario,
        'budget_ms': budget,
        'observed_ms': observed,
        'sample_count': len(selected),
        'status': status,
        'severity': severity,
        'ok': status != 'fail',
        'detail': detail,
    }


def check_instrumentation_points() -> list[dict[str, Any]]:
    cache: dict[str, str] = {}
    rows: list[dict[str, Any]] = []
    for point in PERF_POINTS:
        for rel_path, needle in point['anchors']:
            if rel_path not in cache:
                cache[rel_path] = read_text(ROOT / rel_path)
            exists = needle in cache[rel_path]
            rows.append({
                'point': point['name'],
                'file': rel_path,
                'needle': needle,
                'ok': exists,
            })
    return rows


def main() -> int:
    mode = str(os.environ.get('PERF_BUDGET_MODE', 'warn')).strip().lower() or 'warn'
    if mode not in {'warn', 'enforce'}:
        mode = 'warn'

    instrumentation = check_instrumentation_points()
    metrics, metrics_source = load_metrics()
    evaluations = [evaluate_point(point, metrics, mode) for point in PERF_POINTS]

    instrumentation_ok = all(row['ok'] for row in instrumentation)
    failures = [row for row in evaluations if row['status'] == 'fail']
    warnings = [row for row in evaluations if row['status'] in {'warn', 'missing'}]

    payload = {
        'ok': instrumentation_ok and not failures,
        'mode': mode,
        'metrics_source': metrics_source,
        'instrumentation_points': instrumentation,
        'budget_evaluations': evaluations,
        'summary': {
            'instrumentation_ok': instrumentation_ok,
            'failure_count': len(failures),
            'warning_count': len(warnings),
        },
    }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
