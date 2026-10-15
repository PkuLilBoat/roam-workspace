import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const auditPath = process.argv.slice(2).find((argument) => argument !== "--");
assert.ok(
    auditPath,
    "Usage: node scripts/validate-page-stream-content-continuity-audit.mjs <ui-audit.json>"
);

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const continuity = audit?.actions?.pageStreamVisibleContentContinuity;
assert.equal(
    continuity?.status,
    "passed",
    continuity?.reason ?? "Page Stream content continuity audit did not pass"
);
assert.equal(continuity.poolWithinLimit, true, "editor pool exceeded its limit");
assert.equal(
    continuity.instrumentationNeutral,
    true,
    "runtime audit changed Page Stream layout through an audit/test/fixture class"
);
assert.equal(
    continuity.listLayout?.auditLayoutClassPresent,
    false,
    "Page Stream list still has a layout-affecting audit class"
);
assert.match(
    continuity.listLayout?.overflowY ?? "",
    /^(auto|scroll)$/,
    "Page Stream list is not the vertical scroll owner"
);
assert.ok(continuity.maxScroll > 0, "runtime fixture did not create a scrollable Page Stream");
assert.ok(
    continuity.listLayout?.scrollHeight > continuity.listLayout?.clientHeight,
    "Page Stream fixture did not overflow the real pane"
);
assert.ok(continuity.expandedCount >= 6, "expected at least six expanded fixture cards");
assert.equal(continuity.collapsedCount, 2, "expected two collapsed fixture cards");
assert.equal(
    continuity.expandedCardsHaveContent,
    true,
    "one or more expanded Page Stream cards lost their visible content layer"
);
assert.equal(
    continuity.scrollSamplesPassed,
    true,
    "top, middle, or bottom viewport sample lost visible content"
);
assert.equal(
    continuity.waterfallLayoutPassed,
    true,
    "expanded Page Stream cards were flex-shrunk or clipped"
);
assert.equal(continuity.cards?.length, 8, "expected eight runtime fixture cards");

for (const card of continuity.cards ?? []) {
    if (card.collapsed) continue;
    assert.equal(card.flexShrink, "0", `${card.path}: card can shrink in the stream`);
    assert.equal(card.clipped, false, `${card.path}: expanded card content is clipped`);
    assert.doesNotMatch(
        card.cardOverflowY,
        /^(auto|scroll)$/,
        `${card.path}: card owns an internal vertical scrollbar`
    );
    assert.doesNotMatch(
        card.bodyOverflowY,
        /^(auto|scroll)$/,
        `${card.path}: card body owns an internal vertical scrollbar`
    );
    assert.equal(card.markerPresent, true, `${card.path}: fixture marker missing`);
    assert.equal(card.hasVisibleContent, true, `${card.path}: no visible content layer`);
    assert.equal(card.placeholderOnly, false, `${card.path}: placeholder-only card`);
}

assert.deepEqual(
    continuity.scrollSamples?.map((sample) => sample.label),
    ["top", "middle", "bottom"],
    "expected top, middle, and bottom viewport samples"
);
assert.ok(
    continuity.scrollSamples?.[1]?.scrollTop > 0,
    "middle sample did not leave the top viewport"
);
assert.ok(
    continuity.scrollSamples?.[2]?.scrollTop >=
        continuity.scrollSamples?.[1]?.scrollTop,
    "bottom sample did not reach the lower viewport"
);

console.log("Page Stream visible content continuity audit passed");
