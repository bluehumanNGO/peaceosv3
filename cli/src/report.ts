import type { CheckId, VerifyReport } from '@peaceos/core';

const CHECK_LABELS: Record<CheckId, string> = {
  integrity: 'Integrity',
  field_signature: 'Field signature',
  org_countersignature: 'Org countersignature',
  org_identity: 'Org identity',
  timestamp: 'Timestamp',
  package_id: 'Package ID',
};

const STATUS_LABELS = {
  ok: 'OK',
  fail: 'FAIL',
  not_determined: 'NOT DETERMINED',
} as const;

export function formatReportHuman(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`Package: ${report.packagePath}`);
  lines.push(`package_id: ${report.packageId ?? '(unknown — manifest failed schema validation)'}`);
  lines.push('');

  if (!report.schemaValid) {
    lines.push('Manifest failed schema validation:');
    for (const error of report.schemaErrors) lines.push(`  - ${error}`);
    lines.push('');
  }

  for (const check of report.checks) {
    lines.push(`${CHECK_LABELS[check.id]}: ${STATUS_LABELS[check.status]} — ${check.message}`);
  }

  lines.push('');
  lines.push(`Verdict: ${report.verdict === 'authentic' ? 'AUTHENTIC' : 'PROBLEMS DETECTED'}`);
  return lines.join('\n');
}
