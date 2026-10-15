import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/style/index.css", import.meta.url), "utf8");
const forbiddenProperties = new Set([
    "bottom",
    "display",
    "flex",
    "flex-basis",
    "flex-grow",
    "flex-shrink",
    "grid",
    "grid-template-columns",
    "height",
    "inset",
    "left",
    "margin",
    "margin-block",
    "margin-inline",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "overflow",
    "overflow-x",
    "overflow-y",
    "padding",
    "padding-block",
    "padding-inline",
    "position",
    "right",
    "top",
    "transform",
    "width",
]);

const violations = [];
const blockPattern = /([^{}]+)\{([^{}]*)\}/gu;
for (const match of css.matchAll(blockPattern)) {
    const selector = match[1].trim();
    if (!/(?:audit|fixture|test)/iu.test(selector)) continue;

    for (const declaration of match[2].split(";")) {
        const separator = declaration.indexOf(":");
        if (separator < 0) continue;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        if (forbiddenProperties.has(property)) {
            violations.push(`${selector}: ${property}`);
        }
    }
}

assert.deepEqual(
    violations,
    [],
    `audit/test/fixture CSS must not alter product layout:\n${violations.join("\n")}`
);

console.log("Audit layout neutrality test passed");
