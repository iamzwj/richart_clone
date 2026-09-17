import assert from "node:assert/strict";
import test from "node:test";
import { missingFields, normaliseBrief } from "@/lib/design";
import { designResolutionFor, DEFAULT_DESIGN_SIZE, normaliseDesignSize } from "@/lib/design-sizes";

test("requires only title, size and style before image generation", () => {
  const brief = normaliseBrief({
    title: "秋日市集",
    size: "9:16",
    style: "温暖插画",
  });

  assert.deepEqual(missingFields(brief), []);
});

test("reports the remaining required design fields", () => {
  const brief = normaliseBrief({ title: "秋日市集" });

  assert.deepEqual(missingFields(brief), ["style"]);
});

test("defaults poster size to 9:16 and maps selected ratios to pixels", () => {
  assert.equal(normaliseBrief({ title: "秋日市集" }).size, DEFAULT_DESIGN_SIZE);
  assert.equal(normaliseDesignSize("21：9"), "21:9");
  assert.equal(designResolutionFor("1:3"), "1024x3072");
  assert.equal(designResolutionFor("21:9"), "2389x1024");
});
