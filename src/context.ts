import * as vscode from "vscode";

export type EditorContext = {
  filePath: string;
  languageId: string;
  fullText: string;
  selectedText: string;
};

export function getEditorContext(): EditorContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const doc = editor.document;
  if (doc.uri.scheme !== "file") return null;
  const selection = editor.selection;
  const selectedText = selection.isEmpty ? "" : doc.getText(selection);

  return {
    filePath: doc.uri.fsPath,
    languageId: doc.languageId,
    fullText: doc.getText(),
    selectedText
  };
}
