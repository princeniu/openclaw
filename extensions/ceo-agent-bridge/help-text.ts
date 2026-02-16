const HELP_LINES = [
  "CEO 指令帮助：",
  "",
  "模式控制：",
  "- /ceo on",
  "- /ceo off",
  "- /ceo status",
  "- /ceo help",
  "",
  "业务指令示例：",
  "- daily",
  "- 周报",
  "- 会议纪要 决策：... 待办：...",
  "- latest runs 5",
  "- sync metrics",
];

export function buildCeoHelpText(): string {
  return HELP_LINES.join("\n");
}
