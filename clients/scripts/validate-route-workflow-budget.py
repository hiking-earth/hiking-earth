#!/usr/bin/env python3
"""Fail closed if route collector timeouts consume the publication reserve."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/route-catalog-update.yml'
MINIMUM_JOB_RESERVE_MINUTES = 10


def main() -> int:
    text = WORKFLOW.read_text(encoding='utf-8')
    job_timeout_match = re.search(r'(?m)^    timeout-minutes:\s*(\d+)\s*$', text)
    if not job_timeout_match:
        print('Could not identify the route collection job timeout.', file=sys.stderr)
        return 1
    job_timeout = int(job_timeout_match.group(1))

    collector_window = re.search(
        r'(?ms)^      - name: Collect USDA source records\n(.*?)'
        r'(?=^      - name: Record collection outcomes\n)',
        text,
    )
    if not collector_window:
        print('Could not identify the route collector section.', file=sys.stderr)
        return 1
    outcome_step = re.search(
        r'(?ms)^      - name: Record collection outcomes\n(.*?)(?=^      - name:|\Z)',
        text,
    )
    if not outcome_step:
        print('Could not identify the route source status report step.', file=sys.stderr)
        return 1
    collector_steps = re.findall(
        r'(?ms)^      - name: (Collect [^\n]+)\n(.*?)(?=^      - name:|\Z)',
        collector_window.group(0),
    )
    if not collector_steps:
        print('No route collectors were found.', file=sys.stderr)
        return 1

    collector_ids = set()
    for name, body in collector_steps:
        step_id = re.search(r'(?m)^        id:\s*([a-z0-9_-]+)\s*$', body)
        timeout = re.search(r'(?m)^        timeout-minutes:\s*(\d+)\s*$', body)
        if not step_id or not timeout or int(timeout.group(1)) < 1:
            print(f'Collector must have a stable ID and positive timeout: {name}', file=sys.stderr)
            return 1
        if '        continue-on-error: true' not in body:
            print(f'Collector failure must not prevent later sources from running: {name}', file=sys.stderr)
            return 1
        if step_id.group(1) in collector_ids:
            print(f'Collector step ID is duplicated: {step_id.group(1)}', file=sys.stderr)
            return 1
        collector_ids.add(step_id.group(1))
        reference = f'steps.{step_id.group(1)}.outcome'
        if reference not in outcome_step.group(1):
            print(f'Collector outcome is not reported: {step_id.group(1)}', file=sys.stderr)
            return 1

    step_timeouts = [int(value) for value in re.findall(
        r'(?m)^        timeout-minutes:\s*(\d+)\s*$', text
    )]
    explicit_minutes = sum(step_timeouts)
    reserve = job_timeout - explicit_minutes
    if reserve < MINIMUM_JOB_RESERVE_MINUTES:
        print(
            f'Explicit step limits consume {explicit_minutes}/{job_timeout} job minutes; '
            f'{reserve} minutes remain, below the {MINIMUM_JOB_RESERVE_MINUTES}-minute reserve.',
            file=sys.stderr,
        )
        return 1

    collector_minutes = sum(
        int(re.search(r'(?m)^        timeout-minutes:\s*(\d+)\s*$', body).group(1))
        for _, body in collector_steps
    )
    print(
        f'Route workflow budget: {len(collector_ids)} collectors allow '
        f'{collector_minutes} minutes; explicit steps reserve {reserve}/{job_timeout} '
        'job minutes.'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
