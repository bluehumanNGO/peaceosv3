import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { manifestSchema } from '@peaceos/spec';

const addFormatsPlugin = addFormats as unknown as FormatsPlugin;

let validateFn: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validateFn) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormatsPlugin(ajv);
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
