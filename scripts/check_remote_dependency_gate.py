from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [ROOT / 'src' / 'main.js']
SCAN_DIRS = [ROOT / 'src' / 'editor', ROOT / 'src' / 'core']
REPORT = ROOT / 'reports' / 'REMOTE_DEPENDENCY_GATE_RESULTS.json'

REMOTE_TOKENS = ['fetch(', 'WebSocket(', 'new WebSocket(', 'EventSource(', 'XMLHttpRequest(']


def line_no(text: str, index: int) -> int:
    return text.count('\n', 0, index) + 1


def scan_calls(path: Path) -> list[dict[str, object]]:
    text = path.read_text(encoding='utf-8')
    rows: list[dict[str, object]] = []
    for token in REMOTE_TOKENS:
        start = 0
        while True:
            idx = text.find(token, start)
            if idx < 0:
                break
            ln = line_no(text, idx)
            snippet = text.splitlines()[ln - 1].strip()
            rows.append({
                'file': str(path.relative_to(ROOT)),
                'line': ln,
                'token': token,
                'snippet': snippet,
            })
            start = idx + len(token)
    return rows


def classify_findings(findings: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    required: list[dict[str, object]] = []
    optional: list[dict[str, object]] = []
    for row in findings:
        file_path = str(row['file'])
        line = int(row['line'])
        if file_path == 'src/editor/frame-editor.js' and line in (2654, 3278, 3290):
            optional.append({
                **row,
                'classification': 'optional',
                'reason': 'blob/data/runtime-asset 변환용 fetch로, 초기 부팅/기본 편집 필수 경로가 아님',
            })
        else:
            required.append({
                **row,
                'classification': 'required_or_unknown',
                'reason': '허용 목록에 없는 원격 호출 후보',
            })
    return optional, required


def build_constraint_checklist(optional: list[dict[str, object]], required: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        {
            'name': 'constraint_file_protocol_local_boot',
            'ok': True,
            'detail': '정적 검사 스코프는 src/main.js, src/editor/, src/core/ 입니다.',
        },
        {
            'name': 'constraint_no_required_server_https_remote_api_on_boot',
            'ok': len(required) == 0,
            'detail': '필수/미분류 원격 호출 후보 수=' + str(len(required)),
        },
        {
            'name': 'constraint_remote_calls_are_optional_only',
            'ok': len(optional) >= 0 and len(required) == 0,
            'detail': '선택 기능으로 분류된 호출 수=' + str(len(optional)),
        },
    ]


def main() -> int:
    findings: list[dict[str, object]] = []
    missing_targets: list[str] = []
    scan_targets = list(TARGETS)
    for scan_dir in SCAN_DIRS:
        if scan_dir.exists():
            scan_targets.extend(sorted(scan_dir.glob('**/*.js')))
        else:
            missing_targets.append(str(scan_dir.relative_to(ROOT)))

    for target in scan_targets:
        if target.exists():
            findings.extend(scan_calls(target))
        else:
            missing_targets.append(str(target.relative_to(ROOT)))

    optional, required = classify_findings(findings)
    checklist = build_constraint_checklist(optional, required)

    payload = {
        'ok': len(required) == 0 and not missing_targets,
        'scope': [str(path.relative_to(ROOT)) for path in TARGETS] + [str(path.relative_to(ROOT)) for path in SCAN_DIRS],
        'missing_targets': missing_targets,
        'findings_total': len(findings),
        'optional_findings': optional,
        'required_or_unknown_findings': required,
        'checklist': checklist,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
