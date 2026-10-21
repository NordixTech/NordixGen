import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createNordixJsonSchema } from "../dist/index.js";

const outputPath = fileURLToPath(new URL("../../../nordix.schema.json", import.meta.url));
const schema = createNordixJsonSchema();
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${outputPath}\n`);
