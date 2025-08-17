import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';
import { RESOURCE_REGEX, MODULE_REGEX } from './types';
import { toolCommand } from './config';

let diagnosticCollection: vscode.DiagnosticCollection;

export function initializeDiagnosticCollection(): vscode.DiagnosticCollection {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('tfdocs');
  return diagnosticCollection;
}

export function checkForMissingLockFile(
  document: vscode.TextDocument
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  // Only process Terraform files
  if (document.languageId !== 'terraform') {
    return diagnostics;
  }

  const fullPath = document.fileName
    .split(path.sep)
    .slice(0, -1)
    .join(path.sep);
  const lockFilePath = path.join(fullPath, '.terraform.lock.hcl');

  // If lock file exists, no diagnostics needed
  if (fs.existsSync(lockFilePath)) {
    return diagnostics;
  }

  const text = document.getText();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for resource blocks
    const resourceMatch = RESOURCE_REGEX.exec(line);
    if (resourceMatch) {
      const range = new vscode.Range(
        new vscode.Position(i, 0),
        new vscode.Position(i, line.length)
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        `No .terraform.lock.hcl file found. Consider running ${toolCommand} init.`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.code = 'tfdocs.missing-lock-file';
      diagnostic.source = 'tfdocs';
      diagnostics.push(diagnostic);
    }

    // Check for module blocks
    const moduleMatch = MODULE_REGEX.exec(line);
    if (moduleMatch) {
      const range = new vscode.Range(
        new vscode.Position(i, 0),
        new vscode.Position(i, line.length)
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        `No .terraform.lock.hcl file found. Consider running ${toolCommand} init.`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.code = 'tfdocs.missing-lock-file';
      diagnostic.source = 'tfdocs';
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

export function updateDiagnostics(document: vscode.TextDocument): void {
  if (diagnosticCollection) {
    const diagnostics = checkForMissingLockFile(document);
    diagnosticCollection.set(document.uri, diagnostics);
  }
}

export function setupDiagnosticEventListeners(
  context: vscode.ExtensionContext
): void {
  // Update diagnostics for currently open documents
  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document);
  }

  // Update diagnostics when documents are opened or changed
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      updateDiagnostics(event.document);
    })
  );

  // Update diagnostics when the active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        updateDiagnostics(editor.document);
      }
    })
  );

  // Watch for file system changes (like when lock file is created)
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    '**/.terraform.lock.hcl'
  );
  context.subscriptions.push(fileWatcher);

  fileWatcher.onDidCreate(() => {
    // Refresh diagnostics for all open Terraform files when lock file is created
    vscode.workspace.textDocuments.forEach(doc => {
      if (doc.languageId === 'terraform') {
        updateDiagnostics(doc);
      }
    });
  });

  fileWatcher.onDidDelete(() => {
    // Refresh diagnostics for all open Terraform files when lock file is deleted
    vscode.workspace.textDocuments.forEach(doc => {
      if (doc.languageId === 'terraform') {
        updateDiagnostics(doc);
      }
    });
  });
}
