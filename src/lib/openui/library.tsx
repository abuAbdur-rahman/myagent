import { createLibrary, defineComponent, action, useTriggerAction } from "@openuidev/react-lang";
import { z } from "zod/v4";

import { Markdown } from "../../components/Markdown";

function gapClass(gap: "sm" | "md" | "lg" | undefined): string {
  if (gap === "sm") return "gap-2";
  if (gap === "lg") return "gap-5";
  return "gap-3";
}

const Text = defineComponent({
  name: "Text",
  description: "A short paragraph of markdown text.",
  props: z.object({
    text: z.string(),
    tone: z.enum(["default", "muted"]).optional(),
  }),
  component: ({ props }) => (
    <div className={props.tone === "muted" ? "text-muted" : undefined}>
      <Markdown content={props.text} />
    </div>
  ),
});

const Stat = defineComponent({
  name: "Stat",
  description: "A KPI card with a label, value and optional detail.",
  props: z.object({
    label: z.string(),
    value: z.string(),
    detail: z.string().optional(),
  }),
  component: ({ props }) => (
    <div className="min-w-0 rounded-card border border-border bg-surface-2 px-3 py-2.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{props.value}</div>
      {props.detail && <div className="mt-0.5 text-xs text-muted">{props.detail}</div>}
    </div>
  ),
});

const Table = defineComponent({
  name: "Table",
  description: "A compact data table for comparisons and records.",
  props: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    caption: z.string().optional(),
  }),
  component: ({ props }) => (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-sm">
        {props.caption && (
          <caption className="border-b border-border px-3 py-2 text-left text-xs text-muted">
            {props.caption}
          </caption>
        )}
        <thead className="bg-surface-2">
          <tr>
            {props.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

const List = defineComponent({
  name: "List",
  description: "A bulleted or numbered list.",
  props: z.object({
    items: z.array(z.string()),
    ordered: z.boolean().optional(),
  }),
  component: ({ props }) => (
    <ul
      className={`m-0 space-y-1 pl-5 text-sm ${props.ordered ? "list-decimal" : "list-disc"}`}
    >
      {props.items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  ),
});

const Callout = defineComponent({
  name: "Callout",
  description: "A highlighted note with a title and a tone.",
  props: z.object({
    title: z.string(),
    body: z.string(),
    tone: z.enum(["info", "success", "warn", "danger"]).optional(),
  }),
  component: ({ props }) => {
    const tone = props.tone ?? "info";
    const toneClass =
      tone === "success"
        ? "border-success/40 bg-success/10"
        : tone === "warn"
          ? "border-warn/40 bg-warn/10"
          : tone === "danger"
            ? "border-danger/40 bg-danger/10"
            : "border-border bg-surface-2";
    return (
      <div className={`rounded-card border px-3 py-2.5 ${toneClass}`} role="note">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="mt-1 text-sm text-muted">{props.body}</div>
      </div>
    );
  },
});

const Progress = defineComponent({
  name: "Progress",
  description: "A labelled progress bar.",
  props: z.object({
    label: z.string(),
    value: z.number(),
    max: z.number().optional(),
  }),
  component: ({ props }) => {
    const max = props.max && props.max > 0 ? props.max : 100;
    const pct = Math.max(0, Math.min(100, (props.value / max) * 100));
    return (
      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">{props.label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-active"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={props.value}
          aria-label={props.label}
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  },
});

const BarChart = defineComponent({
  name: "BarChart",
  description: "A horizontal bar chart for comparing magnitudes.",
  props: z.object({
    title: z.string().optional(),
    data: z.array(z.object({ label: z.string(), value: z.number() })),
    unit: z.string().optional(),
  }),
  component: ({ props }) => {
    const max = Math.max(1, ...props.data.map((item) => item.value));
    return (
      <div className="rounded-card border border-border bg-surface-2 px-3 py-3">
        {props.title && <div className="mb-2 text-sm font-medium">{props.title}</div>}
        <div className="space-y-2" role="img" aria-label={props.title ?? "Bar chart"}>
          {props.data.map((item, index) => (
            <div key={index} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 truncate text-muted" title={item.label}>
                {item.label}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-active">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums">
                {item.value}
                {props.unit ?? ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  },
});

const Button = defineComponent({
  name: "Button",
  description: "A button that sends its label or an action to the assistant.",
  props: z.object({
    label: z.string(),
    action: action().optional(),
    variant: z.enum(["primary", "secondary", "ghost"]).optional(),
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const variant = props.variant ?? "secondary";
    const variantClass =
      variant === "primary"
        ? "border-accent bg-accent text-accent-contrast hover:bg-accent/90"
        : variant === "ghost"
          ? "border-transparent text-muted hover:bg-hover hover:text-text"
          : "border-border bg-surface text-text hover:bg-hover";
    return (
      <button
        type="button"
        onClick={() => triggerAction(props.label, undefined, props.action)}
        className={`w-fit rounded-control border px-3 py-1.5 text-sm font-medium ${variantClass}`}
      >
        {props.label}
      </button>
    );
  },
});

const FollowUps = defineComponent({
  name: "FollowUps",
  description: "Clickable suggested follow-up questions.",
  props: z.object({ suggestions: z.array(z.string()) }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    return (
      <div className="flex flex-wrap gap-2">
        {props.suggestions.map((suggestion, index) => (
          <button
            key={index}
            type="button"
            onClick={() => triggerAction(suggestion)}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-text"
          >
            {suggestion}
          </button>
        ))}
      </div>
    );
  },
});

const KeyValue = defineComponent({
  name: "KeyValue",
  description: "A compact list of labels and values.",
  props: z.object({
    pairs: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  component: ({ props }) => (
    <dl className="m-0 grid gap-1.5 rounded-card border border-border bg-surface-2 px-3 py-2.5 text-sm">
      {props.pairs.map((pair, index) => (
        <div key={index} className="flex gap-3">
          <dt className="w-24 shrink-0 text-muted">{pair.key}</dt>
          <dd className="m-0 min-w-0 flex-1 break-words">{pair.value}</dd>
        </div>
      ))}
    </dl>
  ),
});

const Code = defineComponent({
  name: "Code",
  description: "A compact code block with a language label.",
  props: z.object({
    language: z.string(),
    code: z.string(),
  }),
  component: ({ props }) => (
    <div className="overflow-hidden rounded-card border border-border bg-surface-2">
      <div className="border-b border-border px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
        {props.language}
      </div>
      <pre className="m-0 overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{props.code}</code>
      </pre>
    </div>
  ),
});

const leaf = z.union([
  Text.ref,
  Stat.ref,
  Table.ref,
  List.ref,
  Callout.ref,
  Progress.ref,
  BarChart.ref,
  Button.ref,
  FollowUps.ref,
  KeyValue.ref,
  Code.ref,
]);

const Row = defineComponent({
  name: "Row",
  description: "A responsive horizontal group of components.",
  props: z.object({ children: z.array(leaf) }),
  component: ({ props, renderNode }) => (
    <div className="grid w-full gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      {renderNode(props.children)}
    </div>
  ),
});

const Card = defineComponent({
  name: "Card",
  description: "A titled card that groups related components.",
  props: z.object({
    title: z.string(),
    children: z.array(z.union([leaf, Row.ref])),
    subtitle: z.string().optional(),
  }),
  component: ({ props, renderNode }) => (
    <section className="rounded-card border border-border bg-surface p-3.5">
      <header>
        <div className="text-sm font-semibold">{props.title}</div>
        {props.subtitle && <div className="mt-0.5 text-xs text-muted">{props.subtitle}</div>}
      </header>
      <div className="mt-2 flex flex-col gap-2">{renderNode(props.children)}</div>
    </section>
  ),
});

const Stack = defineComponent({
  name: "Stack",
  description: "The page root; stacks sections vertically.",
  props: z.object({
    children: z.array(z.union([leaf, Row.ref, Card.ref])),
    gap: z.enum(["sm", "md", "lg"]).optional(),
  }),
  component: ({ props, renderNode }) => (
    <div className={`flex w-full flex-col ${gapClass(props.gap)}`}>{renderNode(props.children)}</div>
  ),
});

export const openuiLibrary = createLibrary({
  root: "Stack",
  components: [
    Stack,
    Row,
    Card,
    Text,
    Stat,
    Table,
    List,
    Callout,
    Progress,
    BarChart,
    Button,
    FollowUps,
    KeyValue,
    Code,
  ],
  componentGroups: [
    { name: "Layout", components: ["Stack", "Row", "Card"] },
    {
      name: "Content",
      components: [
        "Text",
        "Stat",
        "Table",
        "List",
        "Callout",
        "Progress",
        "BarChart",
        "KeyValue",
        "Code",
      ],
    },
    { name: "Interaction", components: ["Button", "FollowUps"] },
  ],
});
