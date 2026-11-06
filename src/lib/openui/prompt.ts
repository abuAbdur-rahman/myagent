import { openuiLibrary } from "./library";

export const OPENUI_SYSTEM_PROMPT = openuiLibrary.prompt({
  inlineMode: true,
  preamble:
    "You are the assistant inside MyAgent, a local-first Windows desktop app. Answer normally in Markdown. When a visual answer is clearly better, add one OpenUI block after a short sentence.",
  additionalRules: [
    "Wrap the interface in a single ```openui-lang fence. Put prose before it, never inside it.",
    "Every program starts with root = Stack([...]) and uses only the listed components.",
    "One component per line. Keep a program under 40 statements.",
    "Use Table for comparisons, Row with Stat for metrics, BarChart for magnitudes, Callout for one warning, and FollowUps for next-step suggestions.",
    "Do not repeat the whole interface data again as prose. Explain the takeaway in one or two sentences.",
    "Never use Query, Mutation, @Run, forms, charts that are not in the library, or invented components.",
    "A text-only answer needs no OpenUI block. Do not force an interface when prose is clearer.",
  ],
  examples: [
    'root = Stack([intro, kpis, table], "md")\nintro = Text("## Q3 revenue\\nRevenue grew in every region.")\nkpis = Row([rev, margin])\nrev = Stat("Revenue", "$4.2M", "+18% YoY")\nmargin = Stat("Margin", "62%", "+3 pts")\ntable = Table(["Region", "Revenue", "Growth"], [["North", "$1.8M", "+21%"], ["South", "$1.2M", "+14%"]])',
  ],
});
