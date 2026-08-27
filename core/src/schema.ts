import { createRequire } from 'node:module';

import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import { manifestSchema } from '@peaceos/spec';

// Plain default imports of these two CJS packages don't type-check cleanly
// under `moduleResolution: NodeNext` (TS resolves the default binding to the
// whole module-namespace type instead of the actual export, for reasons that
// didn't reduce to a single documented flag). Ajv2020 has a working named
// export, used directly; ajv-formats does not, so it's loaded via
// createRequire, which reflects Node's real CJS interop exactly and sidesteps
// the static-resolution mismatch. Runtime-verified: both resolve correctly.
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as FormatsPlugin;

let validateFn: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validateFn) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    validateFn = ajv.compile(manifestSchema);
  }
  return validateFn;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifestSchema(manifest: unknown): SchemaValidationResult {
  const validate = getValidator();
  const valid = validate(manifest);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).map((error) => `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`);
  return { valid: false, errors };
}
