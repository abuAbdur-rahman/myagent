import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "src-tauri", "target", "debug", "myagent.exe");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "myagent-eval-"));
const shots = path.join(temp, "screenshots");
const configDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "com.abdul.myagent");
const configPath = path.join(configDir, "computer-use.json");
const auditPath = path.join(configDir, "computer-use-audit.jsonl");
const outPath = process.env.MYAGENT_EVAL_OUT || path.join(temp, "results.json");
const notepad = "C:\\Windows\\System32\\notepad.exe";
const explorer = "C:\\Windows\\explorer.exe";
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const textFile = path.join(temp, "eval.txt");
const formFile = path.join(temp, "form.html");
const longFile = path.join(temp, "long.html");
const edgeProfile = path.join(temp, "edge-profile");
const runId = Date.now().toString(36);
const formTitle = `MyAgent Eval Form ${runId}`;
const longTitle = `MyAgent Eval Long ${runId}`;
const edgeFlags = [
  `--user-data-dir=${edgeProfile}`,
  "--guest",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--disable-features=msEdgeSigninPromo,msEdgeSyncPromo,EdgeSigninPromo,msImplicitSignin",
  "--new-window",
];
const evalText = "hello from myagent eval 0.8.0";
const results = [];
const launched = [];
const notepadPids = [];

fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const backups = new Map();
for (const file of [configPath, auditPath]) {
  if (fs.existsSync(file)) backups.set(file, fs.readFileSync(file));
}

fs.writeFileSync(textFile, "");
fs.writeFileSync(
  formFile,
  `<!doctype html><title>${formTitle}</title>
<style>
  html,body{margin:0;height:100%;font:24px sans-serif;background:#fff}
  #n{position:fixed;left:0;top:0;width:100%;height:50%;box-sizing:border-box;font-size:32px;border:4px solid #0a0}
  #p{position:fixed;left:0;top:50%;width:50%;height:20%;box-sizing:border-box;border:4px solid #a00}
  #s,#b{position:fixed;bottom:0;height:30%;box-sizing:border-box;font-size:28px}
  #s{left:0;width:50%;border:4px solid #00a}
  #b{left:50%;width:50%;border:4px solid #aa0}
</style>
<input id=n name=n oninput="document.title='${formTitle} name='+this.value">
<input id=p name=p type=password>
<button id=s onclick="document.title='${formTitle} submitted'">Submit</button>
<button id=b onclick="document.title='${formTitle} cancelled'">Cancel</button>`,
);
fs.writeFileSync(
  longFile,
  `<!doctype html><title>${longTitle}</title><ul>${Array.from({ length: 800 }, (_, i) => `<li>row ${i}</li>`).join("")}</ul>`,
);

function allowlist() {
  return [
    { path: notepad, name: "notepad.exe", tier: "full", publisher: null },
    { path: "", name: "Notepad.exe", tier: "full", publisher: null },
    { path: edge, name: "msedge.exe", tier: "full", publisher: null },
  ];
}

function writeConfig(overrides = {}) {
  const config = {
    enabled: true,
    paused: false,
    dry_run: false,
    overlay: false,
    hotkey: "Ctrl+Alt+Shift+P",
    max_actions_per_run: 200,
    audit_thumbnails: false,
    allow: allowlist(),
    deny: [],
    ...overrides,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

writeConfig();

class Client {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.read(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    child.on("exit", (code) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`server exited with ${code}: ${this.stderr.slice(-1000)}`));
      }
      this.pending.clear();
    });
  }

  read(chunk) {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    }
  }

  request(method, params, timeoutMs = 90000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "myagent-eval", version: "0.2.0" },
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }

  async call(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const images = content.filter((item) => item.type === "image" && item.data).map((item) => ({ data: item.data, mimeType: item.mimeType || "image/png" }));
    return { ok: !result?.isError, text, images };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function act(name, args) {
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await client.call(name, args);
    if (result.ok || !/yield_to_user/i.test(result.text)) return result;
    await sleep(1500);
  }
  return result;
}

async function stateOf(app, window, maxNodes = 600) {
  const result = await client.call("get_state", { app, window, max_nodes: maxNodes });
  if (!result.ok) return null;
  return parse(result.text);
}

async function waitForNode(app, window, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const state = await stateOf(app, window, 200);
    if (state?.nodes?.length) return state;
    await sleep(500);
  }
  throw new Error(`window_not_ready: ${app} ${window || ""}`);
}

async function waitForPage(app, window, attempts = 40) {
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    const state = await stateOf(app, window);
    if (state) {
      const document = (state.nodes || []).find((node) => /^Document$/i.test(node.role));
      if (state.page_tree_unavailable === false && document) return state;
      last = `page_tree_unavailable=${state.page_tree_unavailable} nodes=${(state.nodes || []).length}`;
    }
    await sleep(300);
  }
  throw new Error(`page_never_ready: ${app} ${last}`);
}

async function waitForTitle(app, window, pattern, attempts = 25) {
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    const state = await stateOf(app, window, 60);
    last = String(state?.window?.title || "");
    if (pattern.test(last)) return last;
    await sleep(200);
  }
  throw new Error(`title_never_matched: ${pattern} last=${JSON.stringify(last)}`);
}

function contains(outer, inner) {
  const slack = 2;
  return (
    inner.left >= outer.left - slack &&
    inner.top >= outer.top - slack &&
    inner.right <= outer.right + slack &&
    inner.bottom <= outer.bottom + slack
  );
}

function pageNode(state, predicate) {
  const nodes = state.nodes || [];
  const document = nodes.find((node) => /^Document$/i.test(node.role));
  assert(document, "no document node in the page tree");
  const node = nodes.find((item) => item !== document && item.bounds && contains(document.bounds, item.bounds) && predicate(item));
  assert(node, `page element not found: ${JSON.stringify(nodes.map((item) => [item.role, item.name]))}`);
  return node;
}

function center(node) {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
  };
}

function saveShot(label, result) {
  return result.images.map((image, index) => {
    const file = path.join(shots, `${label}-${index + 1}.png`);
    fs.writeFileSync(file, Buffer.from(image.data, "base64"));
    return file;
  });
}

function desktopShot(label) {
  const file = path.join(shots, `desktop-${label}.png`);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
    "$g=[System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)",
    `$bmp.Save('${file.replaceAll("\\", "\\\\")}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    "$g.Dispose();$bmp.Dispose()",
  ].join("; ");
  spawnSync("powershell", ["-NoProfile", "-Command", script], { windowsHide: true });
  return file;
}

const DISMISS_LABELS = [/^got it$/i, /^no thanks$/i, /^not now$/i, /^skip$/i, /^later$/i, /^not interested$/i, /^continue without signing in$/i];

async function dismissDialogs(app, window) {
  for (let round = 0; round < 3; round += 1) {
    const state = await stateOf(app, window, 300);
    if (!state) return round;
    const button = (state.nodes || []).find(
      (node) => /^Button$/i.test(node.role) && node.bounds && !node.offscreen && DISMISS_LABELS.some((label) => label.test(String(node.name || "").trim())),
    );
    if (!button) return round;
    const point = center(button);
    const click = await act("click", { app, window, x: point.x, y: point.y });
    if (!click.ok) return round;
    await sleep(400);
  }
  return 3;
}

async function task(name, fn) {
  const filter = (process.env.MYAGENT_EVAL_TASKS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (filter.length > 0 && !filter.some((item) => name.toLowerCase().includes(item))) {
    results.push({ name, ok: true, skipped: true, ms: 0, detail: "filtered" });
    return;
  }
  const started = Date.now();
  try {
    const detail = await fn();
    if (detail && typeof detail === "object" && detail.skip) {
      results.push({ name, ok: true, skipped: true, ms: Date.now() - started, detail: detail.skip });
      process.stdout.write(`SKIP ${name}: ${detail.skip}\n`);
      return;
    }
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? "" });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const shot = desktopShot(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    results.push({ name, ok: false, ms: Date.now() - started, detail, desktop: shot });
    process.stdout.write(`FAIL ${name}: ${detail}\n`);
  }
}

function killTree(pid) {
  spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
}

function cleanup() {
  for (const pid of launched) killTree(pid);
  for (const pid of notepadPids) killTree(pid);
  const query = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "Get-Process Notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'eval' } | Select-Object -ExpandProperty Id"],
    { encoding: "utf8", windowsHide: true },
  );
  for (const line of String(query.stdout || "").split(/\s+/)) {
    if (/^\d+$/.test(line)) killTree(Number(line));
  }
}

const child = spawn(exe, ["--computer-use"], { env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const client = new Client(child);

try {
  await client.initialize();

  await task("initialize and list tools", async () => {
    const tools = await client.request("tools/list", {});
    assert(Array.isArray(tools?.tools) && tools.tools.length >= 10, "tools/list returned too few tools");
    return `${tools.tools.length} tools`;
  });

  await task("list windows", async () => {
    const result = await client.call("list_windows", {});
    assert(result.ok, result.text);
    const body = parse(result.text);
    assert(Array.isArray(body?.windows) && body.windows.length > 0, "no top-level windows");
    return `${body.windows.length} windows`;
  });

  await task("launch notepad", async () => {
    const result = await act("launch_app", { path: notepad, args: [textFile], confirm: true });
    assert(result.ok, result.text);
    const pid = Number(parse(result.text)?.pid);
    if (pid > 0) launched.push(pid);
    const state = await waitForNode("Notepad.exe");
    if (Number(state.app?.pid) > 0) notepadPids.push(Number(state.app.pid));
    return `pid ${pid}`;
  });

  await task("observe and type into notepad", async () => {
    const state = await waitForNode("Notepad.exe");
    const node = (state.nodes || []).find((item) => item.actionable && /Document|Edit/i.test(item.role) && !item.password);
    assert(node, "no document node");
    const typed = await act("type_text", { snapshot: state.snapshot, element: node.id, text: evalText });
    assert(typed.ok, typed.text);
    const after = await waitForNode("Notepad.exe");
    const updated = (after.nodes || []).find((item) => String(item.value || "").includes(evalText));
    assert(updated, `notepad value not updated: ${JSON.stringify((after.nodes || []).map((item) => item.value).filter(Boolean))}`);
    return "typed and read back";
  });

  await task("clipboard roundtrip", async () => {
    const marker = `myagent-eval-${Date.now()}`;
    const write = await act("write_clipboard", { text: marker, confirm: true });
    assert(write.ok, write.text);
    const read = await act("read_clipboard", { confirm: true });
    assert(read.ok, read.text);
    assert(read.text.includes(marker), "clipboard text mismatch");
    return marker;
  });

  await task("hard deny explorer", async () => {
    const result = await act("launch_app", { path: explorer, confirm: true });
    assert(!result.ok, "explorer launch unexpectedly succeeded");
    assert(/hard_denied/i.test(result.text), result.text);
    return "hard_denied";
  });

  await task("launch chromium form", async () => {
    const result = await act("launch_app", {
      path: edge,
      args: [...edgeFlags, `file:///${formFile.replaceAll("\\", "/")}`],
      confirm: true,
    });
    assert(result.ok, result.text);
    const pid = Number(parse(result.text)?.pid);
    if (pid > 0) launched.push(pid);
    const state = await waitForPage("msedge.exe", formTitle);
    return `${(state.nodes || []).length} nodes`;
  });

  await task("chromium shows the page, not browser chrome", async () => {
    const state = await waitForPage("msedge.exe", formTitle);
    assert(state.page_tree_unavailable === false, "page_tree_unavailable is true");
    const document = (state.nodes || []).find((node) => /^Document$/i.test(node.role));
    assert(document, "no document node");
    assert(/^MyAgent Eval Form/.test(document.name), `document name is ${document.name}`);
    return `document=${document.name}`;
  });

  await task("screenshot shows the page", async () => {
    const shot = await client.call("screenshot", { app: "msedge.exe", window: formTitle });
    assert(shot.ok, shot.text);
    assert(shot.images.length > 0, "screenshot returned no image");
    const meta = parse(shot.text);
    assert(/MyAgent Eval Form/.test(String(meta?.window || "")), `screenshot window is ${meta?.window}`);
    return saveShot("chromium-page", shot).join(", ");
  });

  await task("dismiss edge startup dialogs", async () => {
    await dismissDialogs("msedge.exe", formTitle);
    const state = await waitForPage("msedge.exe", formTitle);
    const dialog = (state.nodes || []).find((node) => /^Button$/i.test(node.role) && /^got it$/i.test(String(node.name || "").trim()));
    assert(!dialog, "startup dialog is still open");
    return "clear";
  });

  await task("click page field and type", async () => {
    await dismissDialogs("msedge.exe", formTitle);
    const state = await waitForPage("msedge.exe", formTitle);
    const field = pageNode(state, (node) => /Edit/i.test(node.role) && !node.password);
    const point = center(field);
    const click = await act("click", { app: "msedge.exe", window: formTitle, x: point.x, y: point.y });
    assert(click.ok, click.text);
    const shot = await client.call("screenshot", { app: "msedge.exe", window: formTitle });
    if (shot.ok) saveShot("after-page-click", shot);
    const refused = await client.call("type_text", { app: formTitle, text: "typed" });
    assert(!refused.ok, "unconfirmed chromium typing was not refused");
    assert(/unverified_focus/i.test(refused.text), refused.text);
    const typed = await act("type_text", { app: formTitle, text: "typed", confirm: true });
    assert(typed.ok, typed.text);
    const title = await waitForTitle("msedge.exe", formTitle, /name=typed/);
    return `clicked ${point.x},${point.y} -> ${title}`;
  });

  await task("click submit button by point", async () => {
    const state = await waitForPage("msedge.exe", formTitle);
    const button = pageNode(state, (node) => /^Button$/i.test(node.role) && /^Submit$/i.test(String(node.name || "").trim()));
    const point = center(button);
    const click = await act("click", { app: "msedge.exe", window: formTitle, x: point.x, y: point.y });
    assert(click.ok, click.text);
    const title = await waitForTitle("msedge.exe", formTitle, /submitted/);
    return `clicked ${point.x},${point.y} -> ${title}`;
  });

  await task("long page is bounded", async () => {
    const result = await act("launch_app", {
      path: edge,
      args: [...edgeFlags, `file:///${longFile.replaceAll("\\", "/")}`],
      confirm: true,
    });
    assert(result.ok, result.text);
    const pid = Number(parse(result.text)?.pid);
    if (pid > 0) launched.push(pid);
    const state = await waitForPage("msedge.exe", longTitle);
    assert((state.nodes || []).length <= 450, `node count ${(state.nodes || []).length} exceeded the cap`);
    return `${(state.nodes || []).length} nodes`;
  });

  await task("stale snapshot is rejected", async () => {
    const result = await client.call("click", { snapshot: "missing-snapshot", element: "e1" });
    assert(!result.ok, "stale snapshot unexpectedly succeeded");
    assert(/stale_snapshot/i.test(result.text), result.text);
    return "stale_snapshot";
  });

  await task("secure attention is refused", async () => {
    const result = await client.call("press_keys", { app: "notepad.exe", keys: "{ctrl}{alt}{delete}", confirm: true });
    assert(!result.ok, "secure attention unexpectedly succeeded");
    assert(/hard_denied|secure/i.test(result.text), result.text);
    return result.text.slice(0, 120);
  });

  await task("publisher mismatch blocks app", async () => {
    writeConfig({
      allow: [
        { path: notepad, name: "notepad.exe", tier: "full", publisher: "CN=Definitely Not Microsoft" },
        { path: "", name: "Notepad.exe", tier: "full", publisher: "CN=Definitely Not Microsoft" },
        { path: edge, name: "msedge.exe", tier: "full", publisher: null },
      ],
    });
    const result = await client.call("get_state", { app: "Notepad.exe" });
    assert(!result.ok, "publisher mismatch unexpectedly succeeded");
    assert(/publisher_mismatch/i.test(result.text), result.text);
    writeConfig();
    return "publisher_mismatch";
  });

  await task("disabled mode is refused", async () => {
    writeConfig({ enabled: false });
    const result = await client.call("list_windows", {});
    assert(!result.ok, "disabled mode unexpectedly succeeded");
    assert(/computer_use_disabled/i.test(result.text), result.text);
    writeConfig();
    return "computer_use_disabled";
  });

  await task("dry run does not type", async () => {
    writeConfig({ dry_run: true });
    const state = await waitForNode("Notepad.exe");
    const node = (state.nodes || []).find((item) => item.actionable && /Document|Edit/i.test(item.role) && !item.password);
    assert(node, "no document node");
    const result = await client.call("type_text", { snapshot: state.snapshot, element: node.id, text: "should-not-appear" });
    assert(result.ok, result.text);
    assert(parse(result.text)?.dry_run === true, result.text);
    writeConfig();
    return "dry_run";
  });

  await task("action budget is enforced", async () => {
    writeConfig({ max_actions_per_run: 0 });
    const state = await waitForNode("Notepad.exe");
    const node = (state.nodes || []).find((item) => item.actionable && /Document|Edit/i.test(item.role) && !item.password);
    assert(node, "no document node");
    const result = await client.call("type_text", { snapshot: state.snapshot, element: node.id, text: "a" });
    assert(!result.ok, "budget did not stop the action");
    assert(/action_budget_exhausted/i.test(result.text), result.text);
    writeConfig();
    return "action_budget_exhausted";
  });

  await task("paused mode is refused", async () => {
    writeConfig({ paused: true });
    const result = await client.call("list_windows", {});
    assert(!result.ok, "paused mode unexpectedly succeeded");
    assert(/computer_use_paused/i.test(result.text), result.text);
    writeConfig();
    return "computer_use_paused";
  });
} finally {
  cleanup();
  child.stdin.end();
  for (const [file, data] of backups) fs.writeFileSync(file, data);
  if (!backups.has(configPath) && fs.existsSync(configPath)) fs.unlinkSync(configPath);
  if (!backups.has(auditPath) && fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
  const summary = {
    started: new Date().toISOString(),
    exe,
    temp,
    passed: results.filter((item) => item.ok && !item.skipped).length,
    failed: results.filter((item) => !item.ok).length,
    skipped: results.filter((item) => item.skipped).length,
    tasks: results,
    stderr: client.stderr.slice(-4000),
  };
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  process.stdout.write(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped\n`);
  process.stdout.write(`${outPath}\n`);
}
