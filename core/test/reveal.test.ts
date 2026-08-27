import { describe, expect, it } from 'vitest';

import { reveal } from '../src/reveal.js';
import { buildFullTestPackage } from './helpers.js';

describe('reveal mode (B2) — given salt + value, confirm it recomputes the manifest commitment', () => {
  it('matches when the caller supplies the exact salt and value the org custodied', async () => {
    const { outDir, redactionField, redactionSaltBase64, redactionValue } = await buildFullTestPackage();
    const result = await reveal(outDir, { field: redactionField, saltBase64: redactionSaltBase64, value: redactionValue });
    expect(result.matched).toBe(true);
    expect(result.message).toMatch(/recomputes to the committed digest/i);
  });

  it('does NOT match with the wrong value, even with the correct salt (B4)', async () => {
    const { outDir, redactionField, redactionSaltBase64 } = await buildFullTestPackage();
    const result = await reveal(outDir, { field: redactionField, saltBase64: redactionSaltBase64, value: 'Someone Else' });
    expect(result.matched).toBe(false);
  });

  it('does NOT match with the wrong salt, even with the correct value (B4)', async () => {
    const { outDir, redactionField, redactionValue } = await buildFullTestPackage();
    const wrongSalt = Buffer.from(Array.from({ length: 32 }, (_, i) => 0xff - i)).toString('base64');
    const result = await reveal(outDir, { field: redactionField, saltBase64: wrongSalt, value: redactionValue });
    expect(result.matched).toBe(false);
  });

  it('reports no match (not an error) for a field with no redaction entry — never reveals or attempts anything without a real entry to check against', async () => {
    const { outDir, redactionSaltBase64, redactionValue } = await buildFullTestPackage();
    const result = await reveal(outDir, { field: 'no_such_field', saltBase64: redactionSaltBase64, value: redactionValue });
    expect(result.matched).toBe(false);
    expect(result.message).toMatch(/no redaction entry/i);
  });
});
