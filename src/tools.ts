import * as vscode from "vscode";

export type ToolCall = {
  tool:
    | "read_file"
    | "list_files"
    | "search"
    | "apply_edits"
    | "write_file"
    | "repo_browser.apply_edits";
  args: Record<string, any>;
};

export type ToolResult = {
  ok: boolean;
  output: string;
};

function getWorkspaceRoots(): vscode.Uri[] {
  const roots = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
  if (!roots.length) {
    throw new Error("No workspace folder is open.");
  }
  return roots;
}

function getActiveFileUri(): vscode.Uri | null {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== "file") return null;
  return doc.uri;
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function toFullDocumentRange(text: string): vscode.Range {
  const lines = text.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const lastChar = lines[lastLine]?.length ?? 0;
  return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine, lastChar));
}

function applyEditsToText(
  doc: vscode.TextDocument,
  edits: Array<{ range: vscode.Range; newText: string }>
): string {
  const withOffsets = edits.map(e => {
    const safeStart = new vscode.Position(
      Math.max(0, Math.min(e.range.start.line, doc.lineCount - 1)),
      Math.max(0, e.range.start.character)
    );
    const safeEnd = new vscode.Position(
      Math.max(0, Math.min(e.range.end.line, doc.lineCount - 1)),
      Math.max(0, e.range.end.character)
    );
    const start = doc.offsetAt(safeStart);
    const end = doc.offsetAt(safeEnd);
    return { start, end, newText: e.newText };
  });

  withOffsets.sort((a, b) => b.start - a.start);

  let out = doc.getText();
  for (const e of withOffsets) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

function normalizeRel(inputPath: string): string {
  return inputPath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

async function findBestExistingUri(inputPath: string, maxResults = 200): Promise<vscode.Uri | null> {
  const tail = normalizeRel(inputPath).toLowerCase();
  const basename = tail.includes("/") ? tail.slice(tail.lastIndexOf("/") + 1) : tail;
  if (!basename) return null;

  const candidates = await vscode.workspace.findFiles(
    `**/${basename}`,
    "**/{node_modules,.git,out,dist}/**",
    maxResults
  );
  if (!candidates.length) return null;

  const exactTail = candidates.find(u =>
    vscode.workspace.asRelativePath(u, false).replace(/\\/g, "/").toLowerCase().endsWith(tail)
  );
  if (exactTail) return exactTail;

  if (candidates.length === 1) return candidates[0];
  return null;
}

async function normalizePath(
  inputPath: string,
  options?: { mustExist?: boolean }
): Promise<{ root: vscode.Uri; rel: string; uri: vscode.Uri }> {
  if (!inputPath) {
    throw new Error("Missing path.");
  }

  const roots = getWorkspaceRoots();

  // If absolute path, ensure it is under a workspace root and convert to relative.
  if (inputPath.match(/^[a-zA-Z]:\\/)) {
    const normalized = inputPath.replace(/\//g, "\\");
    for (const root of roots) {
      const rootPath = root.fsPath.replace(/\//g, "\\");
      if (normalized.toLowerCase().startsWith(rootPath.toLowerCase() + "\\")) {
        const rel = normalized.slice(rootPath.length + 1);
        if (rel.includes("..")) throw new Error("Path must not contain '..'.");
        const uri = vscode.Uri.joinPath(root, rel);
        if (options?.mustExist && !(await pathExists(uri))) {
          throw new Error(`File not found in workspace: ${inputPath}`);
        }
        return { root, rel, uri };
      }
    }
    throw new Error("Absolute path is not within the workspace.");
  }

  // Relative path
  if (inputPath.includes("..") || inputPath.startsWith("/") || inputPath.startsWith("\\")) {
    throw new Error("Path must be a workspace-relative path without '..'.");
  }

  if (options?.mustExist || roots.length > 1) {
    for (const root of roots) {
      const candidate = vscode.Uri.joinPath(root, inputPath);
      if (await pathExists(candidate)) {
        return { root, rel: inputPath, uri: candidate };
      }
    }
  }

  if (options?.mustExist) {
    const recovered = await findBestExistingUri(inputPath);
    if (recovered) {
      const folder = vscode.workspace.getWorkspaceFolder(recovered);
      if (!folder) {
        throw new Error(`File not found in workspace: ${inputPath}`);
      }
      return {
        root: folder.uri,
        rel: vscode.workspace.asRelativePath(recovered, false),
        uri: recovered
      };
    }
  }

  if (options?.mustExist) {
    throw new Error(`File not found in workspace: ${inputPath}`);
  }

  const root = roots[0];
  return { root, rel: inputPath, uri: vscode.Uri.joinPath(root, inputPath) };
}

export async function runTool(call: ToolCall, cfg: vscode.WorkspaceConfiguration): Promise<ToolResult> {
  try {
    switch (call.tool) {
      case "read_file":
        return await readFileTool(call.args, cfg);
      case "list_files":
        return await listFilesTool(call.args, cfg);
      case "search":
        return await searchTool(call.args, cfg);
      case "apply_edits":
      case "repo_browser.apply_edits":
        return await applyEditsTool(call.args);
      case "write_file":
        return await writeFileTool(call.args);
      default:
        return { ok: false, output: `Unknown tool: ${call.tool}` };
    }
  } catch (err: any) {
    return { ok: false, output: err?.message ?? String(err) };
  }
}

async function readFileTool(args: Record<string, any>, cfg: vscode.WorkspaceConfiguration): Promise<ToolResult> {
  const path = String(args.path ?? "");
  const resolved = await normalizePath(path);
  const uri = resolved.uri;
  const bytes = await vscode.workspace.fs.readFile(uri);
  const maxBytes = cfg.get<number>("maxFileBytes") ?? 200000;
  const sliced = bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
  const text = Buffer.from(sliced).toString("utf8");
  const truncated = bytes.length > maxBytes ? `\n\n[Truncated to ${maxBytes} bytes]` : "";
  return { ok: true, output: text + truncated };
}

async function listFilesTool(args: Record<string, any>, cfg: vscode.WorkspaceConfiguration): Promise<ToolResult> {
  const glob = String(args.glob ?? "**/*");
  const max = cfg.get<number>("maxSearchResults") ?? 50;
  const uris = await vscode.workspace.findFiles(glob, "**/{node_modules,.git,out,dist}/**", max);
  const rels = uris.map(u => vscode.workspace.asRelativePath(u, false));
  return { ok: true, output: rels.join("\n") };
}

async function searchTool(args: Record<string, any>, cfg: vscode.WorkspaceConfiguration): Promise<ToolResult> {
  const query = String(args.query ?? "");
  if (!query) return { ok: false, output: "Missing query" };

  const max = cfg.get<number>("maxSearchResults") ?? 50;
  const maxBytes = cfg.get<number>("maxFileBytes") ?? 200000;
  const matches: Array<{ uri: string; line: number; text: string }> = [];
  const uris = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,out,dist}/**", Math.max(200, max * 4));

  for (const uri of uris) {
    if (matches.length >= max) break;

    const bytes = await vscode.workspace.fs.readFile(uri);
    const sliced = bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
    const text = Buffer.from(sliced).toString("utf8");
    if (text.includes("\u0000")) continue; // skip binary

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= max) break;
      if (lines[i].includes(query)) {
        matches.push({
          uri: vscode.workspace.asRelativePath(uri, false),
          line: i + 1,
          text: lines[i]
        });
      }
    }
  }

  const lines = matches.map(m => `${m.uri}:${m.line}: ${m.text}`);
  return { ok: true, output: lines.join("\n") };
}

async function applyEditsTool(args: Record<string, any>): Promise<ToolResult> {
  if (typeof args.patch === "string" && args.patch.trim().length > 0) {
    return { ok: false, output: "Patch edits are disabled. Use structured apply_edits with ranges." };
  }

  if (typeof args.fullText === "string" && args.fullText.length > 0) {
        return await writeFileTool({ path: args.path, content: args.fullText });
  }

  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (!edits.length) return { ok: false, output: "No edits provided" };

  const defaultPath = String(args.path ?? args.uri ?? args.filePath ?? "");
  const activeFileUri = getActiveFileUri();
  const editsByFile = new Map<string, { uri: vscode.Uri; edits: Array<{ range: vscode.Range; newText: string }> }>();

  for (const e of edits) {
    const uriRel = String(e.uri ?? e.path ?? defaultPath ?? "");
    let uri: vscode.Uri;
    if (uriRel) {
      const resolved = await normalizePath(uriRel, { mustExist: true });
      uri = resolved.uri;
    } else if (activeFileUri) {
      uri = activeFileUri;
    } else {
      return { ok: false, output: "Missing path. Provide args.path (or args.uri) or include edit.path/edit.uri." };
    }

    const r = e.range ?? {};
    const startLine = Number(r.startLine ?? r.start_line ?? r.start?.line ?? 0);
    const startChar = Number(r.startChar ?? r.start_character ?? r.start?.character ?? 0);
    const endLine = Number(r.endLine ?? r.end_line ?? r.end?.line ?? startLine);
    const endChar = Number(r.endChar ?? r.end_character ?? r.end?.character ?? startChar);
    const newText = String(e.newText ?? e.text ?? "");

    const range = new vscode.Range(
      new vscode.Position(startLine, startChar),
      new vscode.Position(endLine, endChar)
    );

    const key = uri.toString();
    const current = editsByFile.get(key) ?? { uri, edits: [] };
    current.edits.push({ range, newText });
    editsByFile.set(key, current);
  }

  for (const { uri, edits: fileEdits } of editsByFile.values()) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const currentText = doc.getText();
    const proposedText = applyEditsToText(doc, fileEdits);

    const wsEdit = new vscode.WorkspaceEdit();
    wsEdit.replace(uri, toFullDocumentRange(currentText), proposedText);
    const applied = await vscode.workspace.applyEdit(wsEdit);
    if (!applied) {
      return { ok: false, output: "Edit rejected by workspace." };
    }
  }

  return { ok: true, output: "Edits applied." };
}

async function writeFileTool(args: Record<string, any>): Promise<ToolResult> {
  const path = String(args.path ?? args.uri ?? args.filePath ?? "");
  const content = String(args.content ?? "");
  if (!path) return { ok: false, output: "Missing path" };

  const resolved = await normalizePath(path);
  const uri = resolved.uri;
  const exists = await pathExists(uri);
 
  const currentText = exists ? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8") : "";

  const wsEdit = new vscode.WorkspaceEdit();
  if (exists) {
    wsEdit.replace(uri, toFullDocumentRange(currentText), content);
  } else {
    wsEdit.createFile(uri, { ignoreIfExists: true });
    wsEdit.insert(uri, new vscode.Position(0, 0), content);
  }

  const applied = await vscode.workspace.applyEdit(wsEdit);
  return {
    ok: applied,
    output: applied ? "File written." : "Write rejected by workspace."
  };
}
