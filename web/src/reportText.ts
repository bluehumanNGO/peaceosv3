import type { CheckId, CheckResult, VerifyReport } from '@peaceos/core';

import { CHECK_COPY, getStatusLabel, getVerdictCopy } from './copy.js';

export const CHECK_LABELS: Record<CheckId, string> = Object.fromEntries(
  Object.entries(CHECK_COPY).map(([id, copy]) => [id, copy.name]),
) as Record<CheckId, string>;

export const STATUS_LABELS = {
  ok: 'Correcto',
  fail: 'Problema',
  not_determined: 'Sin comprobar',
} as const;

export function formatVerdict(report: VerifyReport): string {
  return getVerdictCopy(report).title;
}

export function formatCheckStatus(check: CheckResult): string {
  return getStatusLabel(check);
}
