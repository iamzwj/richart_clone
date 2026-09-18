import OpenAI from "openai";
import { DEFAULT_DESIGN_SIZE, normaliseDesignSize } from "@/lib/design-sizes";

export type DesignBrief = {
  title: string;
  subtitle: string;
  copy: string;
  supplement: string;
  size: string;
  style: string;
};

export const emptyDesignBrief: DesignBrief = {
  title: "",
  subtitle: "",
  copy: "",
  supplement: "",
  size: DEFAULT_DESIGN_SIZE,
  style: "",
};

export const fieldLabels: Record<keyof DesignBrief, string> = {
  title: "主标题",
  subtitle: "副标题",
  copy: "文案",
  size: "比例",
  style: "风格",
  supplement: "补充说明",
};

const requiredFields: (keyof DesignBrief)[] = ["title", "size", "style"];

function getClient(): OpenAI {
  const apiKey = process.env.GRSAI_API_KEY;
  if (!apiKey) throw new Error("GRSAI_API_KEY is not configured.");

  const baseUrl = (process.env.GRSAI_BASE_URL || "https://grsaiapi.com").replace(/\/$/, "");
  return new OpenAI({ apiKey, baseURL: `${baseUrl}/v1` });
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 1_000) : "";
}

function parseResponse(content: string): Partial<DesignBrief> {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return {};

  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    return {
      title: clean(value.title),
      subtitle: clean(value.subtitle),
      copy: clean(value.copy),
      supplement: clean(value.supplement),
      size: clean(value.size),
      style: clean(value.style),
    };
  } catch {
    return {};
  }
}

function findExplicitSize(message: string): string {
  const match = message.match(/\d{1,2}\s*[:：]\s*\d{1,2}|\d{3,4}\s*[x×*]\s*\d{3,4}/);
  return match ? match[0].replace(/[：]/g, ":").replace(/[×*]/g, "x").replace(/\s/g, "") : "";
}

export function normaliseBrief(value: Partial<DesignBrief>): DesignBrief {
  return {
    title: clean(value.title),
    subtitle: clean(value.subtitle),
    copy: clean(value.copy),
    supplement: clean(value.supplement),
    size: normaliseDesignSize(value.size),
    style: clean(value.style),
  };
}

export function missingFields(brief: DesignBrief): (keyof DesignBrief)[] {
  return requiredFields.filter((field) => !brief[field]);
}

export async function extractDesignBrief(
  message: string,
  current: DesignBrief,
): Promise<DesignBrief> {
  const response = await getClient().chat.completions.create({
    model: process.env.GRSAI_MODEL || "gemini-3.1-flash-lite",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Extract a Chinese design brief. Return only a JSON object with exactly these keys: title, subtitle, copy, supplement, size, style. Each value must be a string. Current brief: ${JSON.stringify(current)}. Preserve every current value unless the newest user message explicitly provides a replacement. Extract only stated facts; use an empty string for missing fields. Size may be an aspect ratio such as 9:16, 16:9, 1:1, or a pixel dimension. Do not add explanations.`,
      },
      { role: "user", content: message.slice(0, 2_000) },
    ],
  });

  const extracted = parseResponse(response.choices[0]?.message.content || "");
  const next = normaliseBrief({
    title: extracted.title || current.title,
    subtitle: extracted.subtitle || current.subtitle,
    copy: extracted.copy || current.copy,
    supplement: extracted.supplement || current.supplement,
    size: extracted.size || findExplicitSize(message) || current.size,
    style: extracted.style || current.style,
  });

  return next;
}
