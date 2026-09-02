import { readFile, writeFile } from "node:fs/promises";

const schema = await readFile(new URL("../schema/envelope-v1.json", import.meta.url), "utf8");
const output = `// Code generated from packages/protocol/schema/envelope-v1.json; DO NOT EDIT.\n\npackage event\n\nvar EnvelopeV1Schema = []byte(${JSON.stringify(schema)})\n`;
await writeFile(new URL("../../../internal/event/schema_gen.go", import.meta.url), output);
