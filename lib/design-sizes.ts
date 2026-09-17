export const DEFAULT_DESIGN_SIZE = "9:16";

export const DESIGN_SIZE_OPTIONS = [
  { value: "1:3", resolution: "1024x3072" },
  { value: "9:21", resolution: "1024x2389" },
  { value: "9:16", resolution: "1024x1792" },
  { value: "3:4", resolution: "1024x1365" },
  { value: "1:1", resolution: "1024x1024" },
  { value: "4:3", resolution: "1365x1024" },
  { value: "16:9", resolution: "1792x1024" },
  { value: "21:9", resolution: "2389x1024" },
  { value: "3:1", resolution: "3072x1024" },
] as const;

function normalise(value: string): string {
  return value.replace(/[：]/g, ":").replace(/\s/g, "");
}

export function normaliseDesignSize(value: unknown): string {
  const candidate = typeof value === "string" ? normalise(value) : "";
  return DESIGN_SIZE_OPTIONS.some((option) => option.value === candidate)
    ? candidate
    : DEFAULT_DESIGN_SIZE;
}

export function designResolutionFor(size: string): string {
  const resolved = normaliseDesignSize(size);
  return DESIGN_SIZE_OPTIONS.find((option) => option.value === resolved)?.resolution || "1024x1792";
}
