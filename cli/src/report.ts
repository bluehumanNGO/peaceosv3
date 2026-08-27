import type { CheckId, CheckResult, VerifyReport } from '@peaceos/core';

const CHECK_LABELS: Record<CheckId, string> = {
  integrity: 'Integrity',
  field_signature: 'Field signature',
  org_countersignature: 'Org countersignature',
  org_identity: 'Org identity',
  timestamp: 'Timestamp',
  package_id: 'Package ID',
  custody: 'Custody',
  redactions: 'Redactions',
};

const STATUS_LABELS = {
  ok: 'OK',
  fail: 'FAIL',
  not_determined: 'NOT DETERMINED',
} as const;

/**
 * The timestamp check gets its own label instead of the generic OK/FAIL/NOT
 * DETERMINED ones (A1): "bound (offline)" vs. "anchored (chain-confirmed)"
 * are different, non-interchangeable claims, and burying that distinction
 * inside the message text would be too easy to miss.
 */
function formatTimestampLine(check: CheckResult): string {
  const level = check.details?.level;
  if (check.status === 'ok' && level === 'anchored') {
    return `${CHECK_LABELS.timestamp}: anchored (chain-confirmed) — ${check.message}`;
  }
  if (check.status === 'ok' && level === 'bound') {
    return `${CHECK_LABELS.timestamp}: bound (offline) — ${check.message}`;
  }
  if (check.status === 'not_determined') {
    return `${CHECK_LABELS.timestamp}: NOT DETERMINED (chain confirmation attempted) — ${check.message}`;
  }
  return `${CHECK_LABELS.timestamp}: ${STATUS_LABELS[check.status]} — ${check.message}`;
}

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
    lines.push(
      check.id === 'timestamp' ? formatTimestampLine(check) : `${CHECK_LABELS[check.id]}: ${STATUS_LABELS[check.status]} — ${check.message}`,
    );
  }

  lines.push('');
  lines.push(`Verdict: ${report.verdict === 'authentic' ? 'AUTHENTIC' : 'PROBLEMS DETECTED'}`);

  const timestampCheck = report.checks.find((check) => check.id === 'timestamp');
  if (report.verdict === 'authentic' && timestampCheck?.details?.level === 'bound') {
    lines.push('Note: timestamp not chain-confirmed; run with --check-bitcoin <esplora-url> to confirm.');
  }

  return lines.join('\n');
}
