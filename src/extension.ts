import * as vscode from "vscode";
import { chatCompletion, ChatMessage } from "./lmstudio";
import { getEditorContext } from "./context";
import { runTool, ToolCall } from "./tools";

const SYSTEM_PROMPT = [
  "You are a local coding assistant running inside VS Code.",
  "You can handle casual conversation briefly, but always steer back toward helping with coding tasks.",
  "When you need files or edits, use a tool call.",
  "Tool call format:",
  "TOOL: {\"tool\": \"read_file|list_files|search|apply_edits|write_file\", \"args\": {...}}",
  "Only use workspace-relative paths with no '..'.",
  "For apply_edits, use 0-based line/character indexes.",
  "For apply_edits, each edit item must include: {\"range\": {...}, \"newText\": \"...\"}.",
  "If you are replacing the entire file, use write_file with the full content.",
  "After tool results, respond with either another TOOL call or a final answer.",
  "Never fabricate file contents; use read_file or search.",
  "Do not use special tokens like <|channel|> or tool syntax other than the TOOL: format.",
  "Do not use unified diff or patch formats."
].join("\n");

function parseToolCall(text: string): ToolCall | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("TOOL:")) return null;

  let payload = trimmed.slice(5).trim();
  if (payload.startsWith("```")) {
    payload = payload.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  }

  const direct = parseToolCallPayload(payload);
  if (direct) return direct;

  const extracted = extractFirstJsonObject(payload);
  if (!extracted) return null;
  return parseToolCallPayload(extracted);
}

function tryParseToolJson(text: string): ToolCall | null {
  // Tolerate model outputs like: <|channel|>commentary ... <|message|>{...}
  const marker = text.indexOf("<|message|>");
  const scoped = marker >= 0 ? text.slice(marker + "<|message|>".length) : text;

  const objectStart = findToolObjectStart(scoped);
  if (objectStart < 0) return null;

  const json = extractFirstJsonObject(scoped, objectStart);
  if (!json) return null;
  return parseToolCallPayload(json);
}

function parseChannelToolCall(text: string): ToolCall | null {
  const toMatch = text.match(/to=([a-zA-Z0-9_.-]+)/);
  if (!toMatch) return null;

  const destination = toMatch[1];
  const marker = text.indexOf("<|message|>");
  const payloadText = marker >= 0 ? text.slice(marker + "<|message|>".length).trim() : "";

  let payloadObj: any = {};
  if (payloadText) {
    const payloadJson = extractFirstJsonObject(payloadText);
    if (payloadJson) {
      payloadObj = parseJsonWithRepairs(payloadJson) ?? {};
    }
  }

  if (payloadObj && typeof payloadObj === "object" && payloadObj.tool && payloadObj.args) {
    return payloadObj as ToolCall;
  }

  const map: Record<string, ToolCall["tool"]> = {
    "repo_browser.list_files": "list_files",
    "repo_browser.read_file": "read_file",
    "repo_browser.search": "search",
    "repo_browser.apply_edits": "repo_browser.apply_edits",
    "repo_browser.write_file": "write_file"
  };

  const mapped = map[destination];
  if (!mapped) return null;
  const args = payloadObj && typeof payloadObj === "object" ? payloadObj : {};
  return { tool: mapped, args };
}

function parseToolCallPayload(payload: string): ToolCall | null {
  const parsed = parseJsonWithRepairs(payload);
  if (!parsed || typeof parsed !== "object") return null;
  return normalizeToolCallObject(parsed);
}

function parseJsonWithRepairs(payload: string): any | null {
  try {
    return JSON.parse(payload);
  } catch {}

  const repaired = repairJsonLikeText(payload);
  if (!repaired) return null;

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function repairJsonLikeText(text: string): string | null {
  if (!text) return null;

  let out = text.trim();
  out = out
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");

  out = escapeRawNewlinesInStrings(out);
  return out;
}

function escapeRawNewlinesInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaping = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inString) {
      out += ch;
      if (ch === "\"") inString = true;
      continue;
    }

    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaping = true;
      continue;
    }

    if (ch === "\"") {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === "\r") {
      out += "\\r";
      continue;
    }

    if (ch === "\n") {
      out += "\\n";
      continue;
    }

    out += ch;
  }

  return out;
}

function normalizeToolCallObject(obj: any): ToolCall | null {
  const tool = String(obj?.tool ?? obj?.name ?? "").trim();
  if (!tool) return null;

  let args: any = obj?.args;
  if (typeof args === "string") {
    const parsedArgs = parseJsonWithRepairs(args);
    args = parsedArgs ?? {};
  }

  if (!args || typeof args !== "object") {
    const { tool: _tool, name: _name, args: _args, ...rest } = obj ?? {};
    args = rest && typeof rest === "object" ? rest : {};
  }

  return { tool: tool as ToolCall["tool"], args };
}

function findToolObjectStart(text: string): number {
  const re = /{\s*"tool"\s*:/g;
  const match = re.exec(text);
  return match?.index ?? -1;
}

function extractFirstJsonObject(text: string, startIndex = 0): string | null {
  const start = text.indexOf("{", startIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function formatEditorContext(): string {
  const ctx = getEditorContext();
  if (!ctx) return "No active editor.";

  const selected = ctx.selectedText ? `\n\nSelected:\n${ctx.selectedText}` : "";
  return [
    `Current file: ${ctx.filePath}`,
    `Language: ${ctx.languageId}`,
    `Full file:\n${ctx.fullText}`,
    selected
  ].join("\n");
}

function isCasualMessage(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return false;
  if (text.length > 80) return false;
  const casualPatterns = [
    /^hi\b/,
    /^hello\b/,
    /^hey\b/,
    /^yo\b/,
    /^how are you\b/,
    /^what'?s up\b/,
    /^thanks\b/,
    /^thank you\b/,
    /^good (morning|afternoon|evening)\b/,
    /^bye\b/
  ];
  return casualPatterns.some(p => p.test(text));
}

async function runAssistant(
  question: string,
  out: vscode.OutputChannel,
  progress?: (event: { type: "status" | "tool"; text: string }) => void
): Promise<string> {
  const cfg = vscode.workspace.getConfiguration("lmstudioAssistant");
  const baseUrl = cfg.get<string>("baseUrl") ?? "http://localhost:1234/v1";
  const model = cfg.get<string>("model") ?? "local-model";
  const maxTurns = cfg.get<number>("maxToolTurns") ?? 6;

  const userContent = isCasualMessage(question)
    ? `${question}\n\nRespond naturally and briefly, then offer coding help in one short sentence.`
    : `${question}\n\n${formatEditorContext()}`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent }
  ];

  out.show(true);
  out.appendLine("=== LM Studio Assistant ===");
  out.appendLine(`Model: ${model}`);
  progress?.({ type: "status", text: `Running with model "${model}"...` });

  for (let i = 0; i < maxTurns; i++) {
    let reply: string;
    try {
      reply = await chatCompletion(baseUrl, model, messages);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      out.appendLine(msg);
      throw new Error(msg);
    }

    const toolCall = parseToolCall(reply) ?? tryParseToolJson(reply) ?? parseChannelToolCall(reply);
    if (!toolCall) {
      if (reply.includes("\"tool\"") || reply.includes("to=TOOL")) {
        const warn = "Tool call detected but JSON was invalid. Requesting a corrected tool call.";
        out.appendLine(warn);
        progress?.({ type: "status", text: warn });
        messages.push({ role: "assistant", content: reply });
        messages.push({
          role: "user",
          content: [
            "Your previous tool call was invalid JSON.",
            "Output exactly one valid tool call in this format:",
            "TOOL: {\"tool\": \"read_file|list_files|search|apply_edits|write_file\", \"args\": {...}}",
            "Do not include any extra tokens or prose.",
            "For apply_edits, each edit must include a \"newText\" field."
          ].join("\n")
        });
        continue;
      }
      out.appendLine(reply);
      return reply;
    }

    out.appendLine(`[tool] ${toolCall.tool}`);
    progress?.({ type: "tool", text: `Running tool: ${toolCall.tool}` });
    const result = await runTool(toolCall, cfg);
    out.appendLine(`[tool] result: ${result.ok ? "OK" : "ERROR"} ${result.output}`);

    messages.push({ role: "assistant", content: reply });
    messages.push({
      role: "user",
      content: `TOOL_RESULT: ${toolCall.tool}\n${result.ok ? "OK" : "ERROR"}\n${result.output}`
    });
  }

  const timeoutMessage = "Tool loop ended without a final answer.";
  out.appendLine(timeoutMessage);
  return timeoutMessage;
}

class LMStudioSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "lmstudioAssistant.chatView";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext, private readonly _out: vscode.OutputChannel) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg?.type === "ask") {
        const question = String(msg.question ?? "").trim();
        if (!question) return;
        try {
          const answer = await runAssistant(question, this._out, event => {
            this._view?.webview.postMessage({ type: event.type, text: event.text });
          });
          this._view?.webview.postMessage({ type: "answer", text: answer });
        } catch (err: any) {
          const errorText = err?.message ?? String(err);
          vscode.window.showErrorMessage(errorText);
          this._view?.webview.postMessage({ type: "error", text: errorText });
        }
        return;
      }

      if (msg?.type === "saveSettings") {
        const cfg = vscode.workspace.getConfiguration("lmstudioAssistant");
        await cfg.update("baseUrl", String(msg.baseUrl ?? "").trim(), vscode.ConfigurationTarget.Global);
        await cfg.update("model", String(msg.model ?? "").trim(), vscode.ConfigurationTarget.Global);
        this._view?.webview.postMessage({ type: "status", text: "Settings saved." });
        return;
      }

      if (msg?.type === "insertToEditor") {
        const editor = vscode.window.activeTextEditor;
        const text = String(msg.text ?? "");
        if (!editor || !text) return;
        await editor.edit(editBuilder => {
          editBuilder.insert(editor.selection.active, text);
        });
      }
    });
  }

  public reveal() {
    this._view?.show?.(true);
  }

  private getHtml(webview: vscode.Webview): string {
    const cfg = vscode.workspace.getConfiguration("lmstudioAssistant");
    const baseUrl = escapeHtml(cfg.get<string>("baseUrl") ?? "http://localhost:1234/v1");
    const model = escapeHtml(cfg.get<string>("model") ?? "local-model");
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LM Studio Assistant</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      overflow: hidden;
    }
    .app {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .panel {
      padding: 12px;
      border-bottom: 1px solid var(--vscode-input-border);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 86%, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .panel-title,
    .composer-title {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--vscode-foreground);
      text-transform: uppercase;
    }
    .row {
      width: 100%;
      margin: 0;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    input, textarea, button {
      width: 100%;
      max-width: 100%;
      display: block;
      box-sizing: border-box;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      padding: 9px 10px;
      font-size: 13px;
      line-height: 1.35;
      font-family: var(--vscode-font-family);
    }
    input, textarea {
      transition: border-color .12s ease-in-out, box-shadow .12s ease-in-out;
    }
    input:focus, textarea:focus {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      outline: none;
    }
    textarea { resize: vertical; min-height: 72px; }
    .buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 8px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: transparent;
      cursor: pointer;
      transition: filter .12s ease-in-out;
    }
    button:hover {
      filter: brightness(1.08);
    }
    .chat-wrap {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      padding: 12px;
      gap: 8px;
    }
    .chat {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding-right: 4px;
    }
    .msg {
      margin-bottom: 10px;
      line-height: 1.4;
      border: 1px solid var(--vscode-input-border);
      border-radius: 10px;
      padding: 10px;
      background: var(--vscode-editor-background);
    }
    .user {
      color: var(--vscode-foreground);
      background: color-mix(in srgb, var(--vscode-editor-background) 70%, var(--vscode-button-background));
    }
    .assistant { color: var(--vscode-foreground); }
    .assistant p {
      margin: 0 0 8px;
    }
    .assistant h2, .assistant h3, .assistant h4 {
      margin: 0 0 8px;
      line-height: 1.3;
    }
    .assistant h2 { font-size: 14px; }
    .assistant h3 { font-size: 13px; }
    .assistant h4 { font-size: 12px; }
    .assistant ul, .assistant ol {
      margin: 0 0 8px 20px;
      padding: 0;
    }
    .assistant li {
      margin: 0 0 4px;
    }
    .assistant hr {
      border: none;
      border-top: 1px solid var(--vscode-input-border);
      margin: 10px 0;
    }
    .assistant table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 8px;
      font-size: 12px;
    }
    .assistant th, .assistant td {
      border: 1px solid var(--vscode-input-border);
      text-align: left;
      padding: 6px 8px;
      vertical-align: top;
    }
    .assistant th {
      background: color-mix(in srgb, var(--vscode-editor-background) 75%, var(--vscode-button-background));
    }
    .assistant .role-label {
      font-weight: 600;
      margin: 0 0 8px;
    }
    .assistant p:last-child, .assistant ul:last-child, .assistant ol:last-child {
      margin-bottom: 0;
    }
    .user {
      white-space: pre-wrap;
    }
    .status { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .composer {
      position: sticky;
      bottom: 0;
      border-top: 1px solid var(--vscode-input-border);
      background: var(--vscode-sideBar-background);
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .composer textarea {
      width: 100%;
      min-height: 84px;
      max-height: 160px;
    }
  </style>
</head>
<body>
    <div class="app">
      <div class="panel">
        <div class="panel-title">Connection</div>
        <div class="row">
          <label for="baseUrl">LM Studio Base URL</label>
          <input id="baseUrl" value="${baseUrl}" />
        </div>
        <div class="row">
        <label for="model">Model</label>
        <input id="model" value="${model}" />
      </div>
      <div class="buttons">
        <button id="saveBtn">Save Settings</button>
        <button id="clearBtn">Clear Chat</button>
      </div>
    </div>

    <div class="chat-wrap">
      <div id="status" class="status">Ready.</div>
      <div id="chat" class="chat"></div>
    </div>

    <div class="composer">
      <div class="composer-title">Chat</div>
      <div class="row">
        <label for="prompt">Message</label>
        <textarea id="prompt" placeholder="Ask coding questions, request edits, or chat briefly..."></textarea>
      </div>
      <div class="buttons">
        <button id="sendBtn">Send</button>
        <button id="insertBtn">Insert Last Reply</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const statusEl = document.getElementById("status");
    const promptEl = document.getElementById("prompt");
    const baseUrlEl = document.getElementById("baseUrl");
    const modelEl = document.getElementById("model");
    const savedState = vscode.getState() || {};
    let chatEntries = Array.isArray(savedState.chatEntries) ? savedState.chatEntries : [];
    let lastReply = typeof savedState.lastReply === "string" ? savedState.lastReply : "";
    if (typeof savedState.status === "string" && savedState.status.trim()) {
      statusEl.textContent = savedState.status;
    }

    function saveState() {
      vscode.setState({
        chatEntries,
        lastReply,
        status: String(statusEl.textContent || "")
      });
    }

    function formatAssistantTextForDisplay(text) {
      let out = String(text || "");
      const fencePattern = "\\x60\\x60\\x60";
      // Hide HTML/XML/SVG-heavy code blocks in chat bubbles.
      out = out.replace(new RegExp(fencePattern + "(?:html|xml|svg)[\\\\s\\\\S]*?" + fencePattern, "gi"), "\\n[Code omitted in chat. Use Insert Last Reply.]\\n");
      // Hide remaining fenced blocks to reduce noisy raw markup.
      out = out.replace(new RegExp(fencePattern + "[\\\\s\\\\S]*?" + fencePattern, "g"), "\\n[Code omitted in chat. Use Insert Last Reply.]\\n");
      // Strip inline HTML tags from visible assistant text.
      out = out.replace(/<\\/?[a-zA-Z][^>]*>/g, "");
      // Simplify common markdown markers for cleaner plain text display.
      out = out.replace(/\\*\\*(.*?)\\*\\*/g, "$1");
      out = out.replace(new RegExp("\\x60([^\\x60]+)\\x60", "g"), "$1");
      out = out.replace(/\\x60/g, "");
      out = out.replace(/\\n{3,}/g, "\\n\\n");
      return out.trim();
    }

    function splitTableCells(line) {
      const trimmed = line.trim().replace(/^\\|/, "").replace(/\\|$/, "");
      return trimmed.split("|").map(cell => cell.trim());
    }

    function isTableDivider(line) {
      const clean = line.trim().replace(/^\\|/, "").replace(/\\|$/, "");
      if (!clean) return false;
      const parts = clean.split("|").map(x => x.trim());
      return parts.length > 0 && parts.every(p => /^:?-{3,}:?$/.test(p));
    }

    function renderAssistantFormatted(container, text) {
      const out = formatAssistantTextForDisplay(text);
      const lines = out.split(/\\r?\\n/);
      let listEl = null;
      let listType = "";

      function flushList() {
        listEl = null;
        listType = "";
      }

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        if (!line) {
          flushList();
          continue;
        }

        if (/^(-{3,}|\\*{3,})$/.test(line)) {
          flushList();
          const hr = document.createElement("hr");
          container.appendChild(hr);
          continue;
        }

        const heading = line.match(/^(#{2,4})\\s+(.*)$/);
        if (heading) {
          flushList();
          const level = Math.min(4, heading[1].length);
          const h = document.createElement("h" + String(level));
          h.textContent = heading[2];
          container.appendChild(h);
          continue;
        }

        if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
          flushList();
          const table = document.createElement("table");
          const thead = document.createElement("thead");
          const tbody = document.createElement("tbody");
          const headerCells = splitTableCells(line);
          const headerRow = document.createElement("tr");
          for (const cell of headerCells) {
            const th = document.createElement("th");
            th.textContent = cell;
            headerRow.appendChild(th);
          }
          thead.appendChild(headerRow);
          table.appendChild(thead);

          i += 2; // skip header + divider
          while (i < lines.length) {
            const rowLine = lines[i].trim();
            if (!rowLine || !rowLine.includes("|") || isTableDivider(rowLine)) {
              i--;
              break;
            }
            const row = document.createElement("tr");
            for (const cell of splitTableCells(rowLine)) {
              const td = document.createElement("td");
              td.textContent = cell;
              row.appendChild(td);
            }
            tbody.appendChild(row);
            i++;
          }
          table.appendChild(tbody);
          container.appendChild(table);
          continue;
        }

        const ordered = line.match(/^(\\d+)\\.\\s+(.*)$/);
        if (ordered) {
          if (!listEl || listType !== "ol") {
            const ol = document.createElement("ol");
            ol.start = Number(ordered[1]);
            container.appendChild(ol);
            listEl = ol;
            listType = "ol";
          }
          const li = document.createElement("li");
          li.textContent = ordered[2];
          listEl.appendChild(li);
          continue;
        }

        const bullet = line.match(/^[-*]\\s+(.*)$/);
        if (bullet) {
          if (!listEl || listType !== "ul") {
            const ul = document.createElement("ul");
            container.appendChild(ul);
            listEl = ul;
            listType = "ul";
          }
          const li = document.createElement("li");
          li.textContent = bullet[1];
          listEl.appendChild(li);
          continue;
        }

        flushList();
        const p = document.createElement("p");
        p.textContent = line;
        container.appendChild(p);
      }

      if (!container.children.length) {
        const p = document.createElement("p");
        p.textContent = out;
        container.appendChild(p);
      }
    }

    function renderMessage(role, text) {
      const div = document.createElement("div");
      div.className = "msg " + role;
      if (role === "assistant") {
        const label = document.createElement("p");
        label.className = "role-label";
        label.textContent = "Assistant";
        div.appendChild(label);
        renderAssistantFormatted(div, text);
      } else {
        div.textContent = "You: " + String(text || "");
      }
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function append(role, text) {
      const normalizedRole = role === "assistant" ? "assistant" : "user";
      const normalizedText = String(text || "");
      chatEntries.push({ role: normalizedRole, text: normalizedText });
      renderMessage(normalizedRole, normalizedText);
      saveState();
    }

    for (const entry of chatEntries) {
      if (!entry || (entry.role !== "assistant" && entry.role !== "user")) continue;
      renderMessage(entry.role, String(entry.text || ""));
    }

    document.getElementById("sendBtn").addEventListener("click", () => {
      const question = String(promptEl.value || "").trim();
      if (!question) return;
      append("user", question);
      statusEl.textContent = "Working...";
      saveState();
      vscode.postMessage({ type: "ask", question });
      promptEl.value = "";
    });

    promptEl.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("sendBtn").click();
      }
    });

    document.getElementById("saveBtn").addEventListener("click", () => {
      vscode.postMessage({
        type: "saveSettings",
        baseUrl: String(baseUrlEl.value || "").trim(),
        model: String(modelEl.value || "").trim()
      });
    });

    document.getElementById("clearBtn").addEventListener("click", () => {
      chat.innerHTML = "";
      statusEl.textContent = "Chat cleared.";
      chatEntries = [];
      lastReply = "";
      saveState();
    });

    document.getElementById("insertBtn").addEventListener("click", () => {
      if (!lastReply) return;
      vscode.postMessage({ type: "insertToEditor", text: lastReply });
    });

    window.addEventListener("message", event => {
      const msg = event.data;
      if (msg.type === "answer") {
        lastReply = String(msg.text || "");
        append("assistant", lastReply);
        statusEl.textContent = "Done.";
        saveState();
      } else if (msg.type === "tool" || msg.type === "status") {
        statusEl.textContent = String(msg.text || "");
        saveState();
      } else if (msg.type === "error") {
        statusEl.textContent = "Error: " + String(msg.text || "");
        saveState();
      }
    });
  </script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("LM Studio Assistant");
  const sidebar = new LMStudioSidebarViewProvider(context, out);

  const openChat = vscode.commands.registerCommand("lmstudioAssistant.openChat", () => {
    sidebar.reveal();
    vscode.commands.executeCommand("workbench.view.extension.lmstudioAssistant");
  });

  const askCommand = vscode.commands.registerCommand("lmstudioAssistant.ask", async () => {
    const question = await vscode.window.showInputBox({ prompt: "Ask LM Studio" });
    if (!question) return;
    try {
      const answer = await runAssistant(question, out);
      sidebar.reveal();
      vscode.commands.executeCommand("workbench.view.extension.lmstudioAssistant");
      vscode.window.showInformationMessage("LM Studio replied. Open LM Studio Assistant view to see details.");
      out.appendLine(answer);
    } catch (err: any) {
      vscode.window.showErrorMessage(err?.message ?? String(err));
    }
  });

  context.subscriptions.push(
    out,
    openChat,
    askCommand,
    vscode.window.registerWebviewViewProvider(LMStudioSidebarViewProvider.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
}

export function deactivate() {}
