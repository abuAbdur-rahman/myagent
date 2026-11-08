export const myagentDark = {
  name: "myagent-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#1c1b19",
    "editor.foreground": "#ebe8e2",
  },
  settings: [
    { settings: { foreground: "#ebe8e2" } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#8a857c", fontStyle: "italic" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.operator.new"],
      settings: { foreground: "#e0966f" },
    },
    {
      scope: ["string", "constant.other.symbol", "string.quoted"],
      settings: { foreground: "#a3cf8f" },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "variable.function",
        "meta.function-call",
      ],
      settings: { foreground: "#8fb8ef" },
    },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#e6b055" },
    },
    {
      scope: ["entity.name.type", "support.type", "entity.name.class", "support.class"],
      settings: { foreground: "#d7b37a" },
    },
    {
      scope: ["variable", "variable.other", "meta.object-literal.key"],
      settings: { foreground: "#ebe8e2" },
    },
    {
      scope: ["markup.heading", "markup.heading entity.name"],
      settings: { foreground: "#e0966f", fontStyle: "bold" },
    },
    {
      scope: ["markup.bold"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["markup.italic"],
      settings: { fontStyle: "italic" },
    },
    {
      scope: ["markup.inserted"],
      settings: { foreground: "#a3cf8f" },
    },
    {
      scope: ["markup.deleted"],
      settings: { foreground: "#f0757c" },
    },
    {
      scope: ["invalid", "invalid.illegal"],
      settings: { foreground: "#f0757c" },
    },
  ],
};

export const myagentLight = {
  name: "myagent-light",
  type: "light" as const,
  colors: {
    "editor.background": "#f3f1ec",
    "editor.foreground": "#1f1d1a",
  },
  settings: [
    { settings: { foreground: "#1f1d1a" } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#8a857c", fontStyle: "italic" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.operator.new"],
      settings: { foreground: "#b3541f" },
    },
    {
      scope: ["string", "constant.other.symbol", "string.quoted"],
      settings: { foreground: "#2f7a3a" },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "variable.function",
        "meta.function-call",
      ],
      settings: { foreground: "#1f5fae" },
    },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#9a5b00" },
    },
    {
      scope: ["entity.name.type", "support.type", "entity.name.class", "support.class"],
      settings: { foreground: "#7a4b00" },
    },
    {
      scope: ["variable", "variable.other", "meta.object-literal.key"],
      settings: { foreground: "#1f1d1a" },
    },
    {
      scope: ["markup.heading", "markup.heading entity.name"],
      settings: { foreground: "#b3541f", fontStyle: "bold" },
    },
    {
      scope: ["markup.bold"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["markup.italic"],
      settings: { fontStyle: "italic" },
    },
    {
      scope: ["markup.inserted"],
      settings: { foreground: "#2f7a3a" },
    },
    {
      scope: ["markup.deleted"],
      settings: { foreground: "#be2f3a" },
    },
    {
      scope: ["invalid", "invalid.illegal"],
      settings: { foreground: "#be2f3a" },
    },
  ],
};
