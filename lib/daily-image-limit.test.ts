import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DAILY_IMAGE_LIMIT, completeDailyImageReservation, releaseDailyImageReservation, reserveDailyImages } from "@/lib/daily-image-limit";

test("caps successful generated images at 100 per Shanghai day", async () => {
  const previous = process.env.DAILY_IMAGE_LIMIT_STORE_PATH;
  const path = join("/tmp", `richart-daily-image-limit-${randomUUID()}.json`);
  process.env.DAILY_IMAGE_LIMIT_STORE_PATH = path;

  try {
    const first = await reserveDailyImages(2);
    assert.ok(first);
    await completeDailyImageReservation(first, 2);
    assert.equal(await reserveDailyImages(DAILY_IMAGE_LIMIT - 1), null);

    const remaining = await reserveDailyImages(DAILY_IMAGE_LIMIT - 2);
    assert.ok(remaining);
    await releaseDailyImageReservation(remaining);
    assert.ok(await reserveDailyImages(DAILY_IMAGE_LIMIT - 2));
  } finally {
    if (previous === undefined) delete process.env.DAILY_IMAGE_LIMIT_STORE_PATH;
    else process.env.DAILY_IMAGE_LIMIT_STORE_PATH = previous;
    await rm(path, { force: true });
  }
});
