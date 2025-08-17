import * as vscode from 'vscode';
import {
  initializeDiagnosticCollection,
  setupDiagnosticEventListeners,
} from './diagnostics';
import { registerCodeActionProvider } from './code-actions';
import { registerCommands } from './commands';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize diagnostic collection
  const diagnosticCollection = initializeDiagnosticCollection();
  context.subscriptions.push(diagnosticCollection);

  // Setup diagnostic event listeners
  setupDiagnosticEventListeners(context);

  // Register code action provider for quick fixes
  registerCodeActionProvider(context);

  // Register all commands
  registerCommands(context);
}
