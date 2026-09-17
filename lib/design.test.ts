import assert from "node:assert/strict";
import test from "node:test";
import { missingFields, normaliseBrief } from "@/lib/design";

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

  assert.deepEqual(missingFields(brief), ["size", "style"]);
});
