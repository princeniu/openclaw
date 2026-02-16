import { describe, expect, test } from "vitest";
import { buildCeoHelpText } from "./help-text.js";

describe("ceo help text", () => {
  test("contains core business commands and examples", () => {
    const text = buildCeoHelpText();
    expect(text).toContain("/ceo on");
    expect(text).toContain("/ceo off");
    expect(text).toContain("/ceo status");
    expect(text).toContain("/ceo help");
    expect(text).toContain("daily");
    expect(text).toContain("周报");
    expect(text).toContain("会议纪要");
    expect(text).toContain("latest runs");
    expect(text).toContain("sync metrics");
  });
});
