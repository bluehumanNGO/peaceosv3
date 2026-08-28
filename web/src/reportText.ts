import type { CheckId, CheckResult, VerifyReport } from '@peaceos/core';

import { getCheckCopy, getStatusLabel, getVerdictCopy } from './copy.js';
import type { Language } from './i18n.js';

export function getCheckLabels(language: Language): Record<CheckId, string> {
  return {
    integrity: getCheckCopy({ id: 'integrity', status: 'ok', message: '' }, language).name,
    field_signature: getCheckCopy({ id: 'field_signature', status: 'ok', message: '' }, language).name,
    org_countersignature: getCheckCopy({ id: 'org_countersignature', status: 'ok', message: '' }, language).name,
    org_identity: getCheckCopy({ id: 'org_identity', status: 'ok', message: '' }, language).name,
    timestamp: getCheckCopy({ id: 'timestamp', status: 'ok', message: '' }, language).name,
    package_id: getCheckCopy({ id: 'package_id', status: 'ok', message: '' }, language).name,
    custody: getCheckCopy({ id: 'custody', status: 'ok', message: '' }, language).name,
    redactions: getCheckCopy({ id: 'redactions', status: 'ok', message: '' }, language).name,
  };
}

export function formatVerdict(report: VerifyReport, language: Language = 'es'): string {
  return getVerdictCopy(report, language).title;
}

export function formatCheckStatus(check: CheckResult, language: Language = 'es'): string {
  return getStatusLabel(check, language);
}
