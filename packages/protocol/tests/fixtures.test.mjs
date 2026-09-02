import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const schema = JSON.parse(
  await readFile(new URL("../schema/envelope-v1.json", import.meta.url), "utf8"),
);
const cases = JSON.parse(
  await readFile(new URL("../fixtures/cases.json", import.meta.url), "utf8"),
);
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

for (const fixture of cases) {
  test(`${fixture.file} is ${fixture.valid ? "valid" : "invalid"}`, async () => {
    const value = JSON.parse(
      await readFile(new URL(`../fixtures/${fixture.file}`, import.meta.url), "utf8"),
    );
    assert.equal(validate(value), fixture.valid, JSON.stringify(validate.errors));
  });
}
