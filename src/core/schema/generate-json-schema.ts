import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { NordixConfigSchema } from './nordix.schema.js';

export function generateJsonSchema(): string {
  const jsonSchema = zodToJsonSchema(NordixConfigSchema, {
    name: 'NordixConfig',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });

  return JSON.stringify(jsonSchema, null, 2);
}

// If executed directly
if (process.argv[1]?.includes('generate-json-schema')) {
  const schemaString = generateJsonSchema();
  const outputPath = resolve(process.cwd(), 'nordix.schema.json');
  writeFileSync(outputPath, schemaString, 'utf-8');
  console.log(`Generated JSON Schema at ${outputPath}`);
}
