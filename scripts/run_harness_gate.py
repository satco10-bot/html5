from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'evals' / 'reports' / 'HARNESS_GATE_RESULTS.json'
PERF_REPORT = ROOT / 'reports' / 'PERF_VALIDATOR_RESULTS.json'
REQUIRED = [
    ROOT / 'AGENTS.md',
    ROOT / 'docs' / 'SPEC.md',
    ROOT / 'docs' / 'CONSTRAINTS.md',
    ROOT / 'docs' / 'ARCHITECTURE.md',
    ROOT / 'docs' / 'STATUS.md',
    ROOT / 'docs' / 'PERF_BUDGETS.md',
    ROOT / 'docs' / 'plans' / 'active' / '2026-04-runtime-assets-phase2.md',
]


def run(cmd: list[str]) -> dict:
    try:
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        return {
            'cmd': cmd,
            'returncode': proc.returncode,
            'stdout_tail': proc.stdout[-4000:],
            'stderr_tail': proc.stderr[-4000:],
            'ok': proc.returncode == 0,
        }
    except FileNotFoundError as exc:
        return {
            'cmd': cmd,
            'returncode': 127,
            'stdout_tail': '',
            'stderr_tail': str(exc),
            'ok': False,
        }


def main() -> int:
    checks = []
    for p in REQUIRED:
        checks.append({'name': f'exists:{p.relative_to(ROOT)}', 'ok': p.exists()})

    commands = [
        ['python3', 'scripts/build_local_bundle.py'],
        ['node', '--check', 'app.bundle.js'],
        ['node', 'scripts/check_save_mode_gate.mjs'],
        ['python3', 'scripts/check_remote_dependency_gate.py'],
        ['python3', 'scripts/validate_perf_budgets.py'],
        ['python3', 'scripts/validate_phase8.py'],
    ]
    results = [run(c) for c in commands]

    perf_summary = {}
    if PERF_REPORT.exists():
        try:
            perf_payload = json.loads(PERF_REPORT.read_text(encoding='utf-8'))
            perf_summary = {
                'ok': bool(perf_payload.get('ok')),
                'mode': perf_payload.get('mode'),
                'metrics_source': perf_payload.get('metrics_source'),
                'summary': perf_payload.get('summary', {}),
            }
        except json.JSONDecodeError:
            perf_summary = {'ok': False, 'error': f'invalid json: {PERF_REPORT.relative_to(ROOT)}'}
    else:
        perf_summary = {'ok': False, 'error': f'missing report: {PERF_REPORT.relative_to(ROOT)}'}

    report = {
        'required_checks': checks,
        'command_results': results,
        'perf_validator': perf_summary,
        'ok': all(c['ok'] for c in checks) and all(r['ok'] for r in results),
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
