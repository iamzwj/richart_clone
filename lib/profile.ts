import { readFileSync } from "node:fs";
import { join } from "node:path";

let profileCache: string | undefined;

export function getProfile(): string {
  if (!profileCache) {
    profileCache = readFileSync(join(process.cwd(), "content", "profile.md"), "utf8");
  }

  return profileCache;
}

