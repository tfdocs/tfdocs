import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';
import { getResourceSlug } from './registry';
import { findMainFileInDir } from './filesystem';
import { getAttribute, getProviderSources } from './terraform';
import { parseTerraformLockFile } from './terraform-lock-parser';
import * as readline from "readline";
import { execSync } from 'child_process';

type URLAction = {
  type: 'url',
  url: string;
}

type NavigateAction = {
  type: 'navigate',
  filePath: string;
}

type Action = URLAction | NavigateAction;

const RESOURCE_REGEX = /(data|resource)\s+"([a-zA-Z-]+)_([a-z0-9_]+)"\s+"([a-z0-9_]+)"/;
const MODULE_REGEX = /(module)\s+"([a-zA-Z0-9_-]+)"/;

let diagnosticCollection: vscode.DiagnosticCollection;

async function getResourceData(document: vscode.TextDocument, position: vscode.Position): Promise<Action | undefined> {
  const line = document.lineAt(position.line).text;
  const match = RESOURCE_REGEX.exec(line);
  
  if (!match) {
    return undefined;
  }

  const resourceType = match[1] === 'resource' ? 'resources' : 'data-sources';
  const providerNamespaces = await getProviderSources(document);
  const namespace = providerNamespaces[match[2]]?.split('/')[0] ?? 'hashicorp';
  const slug = await getResourceSlug(`${namespace}/${match[2]}`, match[3]);
  const fullPath = document.fileName.split(path.sep).slice(0, -1).join(path.sep);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const documentPath = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, fullPath) : fullPath;
  let providerVersion = "latest";

  const lockFilePath = `${fullPath}/.terraform.lock.hcl`;
  
  if (!fs.existsSync(lockFilePath)) {
    // Get configuration for Terraform or OpenTofu
    const config = vscode.workspace.getConfiguration('tfdocs');
    const initTool = config.get<string>('initTool', 'terraform');
    const toolName = initTool === 'tofu' ? 'OpenTofu' : 'Terraform';
    const toolCommand = initTool === 'tofu' ? 'tofu' : 'terraform';
    
    const action = await vscode.window.showWarningMessage(
      `No .terraform.lock.hcl file found. This might indicate that ${toolName} has not been initialized.`,
      `Run ${toolCommand} init`,
      'Cancel'
    );
    
    if (action === `Run ${toolCommand} init`) {
      const outputWindow = vscode.window.createOutputChannel(`${toolName} Init`);
      outputWindow.show();
      outputWindow.appendLine(`Running ${toolCommand} init -input=false -no-color in ${fullPath}`);

      const terminal = vscode.window.createTerminal({
        name: `${toolName} Init`,
        cwd: fullPath,
        hideFromUser: true,
      });

      const logFilename = `${toolCommand}-init.log`;
      const logFile = `${fullPath}/.terraform/logs/${logFilename}`
      execSync(`rm ${logFile} || true`);

      terminal.sendText(`mkdir -p .terraform/logs && ${toolCommand} init -input=false -no-color > .terraform/logs/${logFilename}`, true);
      await waitForProcess(logFile, outputWindow);
      outputWindow.appendLine(`Finished initializing`);
    }
  }

    try {
      const terraformLockFile = fs.readFileSync(lockFilePath, 'utf-8');
      providerVersion = parseTerraformLockFile(terraformLockFile).providers.get(`${namespace}/${match[2]}`)?.version || "latest";
    } catch (error) {
      console.warn('Unable to read .terraform.lock.hcl file:', lockFilePath);
      console.warn('Using latest version for resource lookup');
    }

  return {
    type: 'url',
    url: `https://registry.terraform.io/providers/${namespace}/${match[2]}/${providerVersion}/docs/${resourceType}/${slug}`,
  };
}

async function getModuleData(document: vscode.TextDocument, position: vscode.Position): Promise<Action | undefined> {
  const line = document.lineAt(position.line).text;
  const match = MODULE_REGEX.exec(line);
  
  if (!match) {
    return undefined;
  }
  
  const source = getAttribute(document, position, 'source');
  
  if (!source) {
    return undefined;
  }
  
  if (source.startsWith('app.terraform.io')) {
    const [_, app, name, provider] = source.split('/');
    return {
      type: 'url',
      url: `https://app.terraform.io/app/${app}/registry/modules/private/${app}/${name}/${provider}`,
    };
  }

  if (source.startsWith('.') || source.startsWith('/')) {
    let modulePath: string | undefined = undefined;

    if (source.startsWith('/')) {
      modulePath = source;
    } else {
      modulePath = path.join(document.uri.path, '..', source);
    }

    const mainFile = await findMainFileInDir(modulePath);
    
    if (!mainFile) {
      vscode.window.showErrorMessage(`Could not find main.tf file in ${modulePath}`);
      return undefined;
    }
    
    return {
      type: 'navigate',
      filePath: mainFile,
    };
  }
  
  if (source.includes('//')) {
    const [parent, child] = source.split('//');

    return {
      type: 'url',
      url: `https://registry.terraform.io/modules/${parent}/latest/${child.replace('modules', 'submodules')}`,
    };
  }

  return {
    type: 'url',
    url: `https://registry.terraform.io/modules/${source}/latest`,
  };
}

async function getLineData(document: vscode.TextDocument, position: vscode.Position): Promise<Action | undefined> {
  let lineData: Action | undefined = await getResourceData(document, position);

  if (!lineData) {
    lineData = await getModuleData(document, position);
  }

  if (!lineData) {
    return undefined;
  }

  return lineData;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForProcess(logFile: string, outputWindow: vscode.OutputChannel): Promise<void> {
  const lines: string[] = [];
  let fileHasNewLines = true;

  // go 3 dirs up, then add /.terraform.lock.hcl
  const lockFile = logFile.split("/").slice(0, -3).join("/") + "/.terraform.lock.hcl";

  while (fileHasNewLines || !fs.existsSync(lockFile)) {
    await sleep(fileHasNewLines ? 1000 : 5000);
    fileHasNewLines = false;

    try {
      const newLines = fs.readFileSync(logFile, "utf-8").split("\n");

      if (newLines.length > lines.length) {
        fileHasNewLines = true;

        const diff = newLines.slice(lines.length);
        lines.push(...diff);

        for (const line of diff) {
          if (line.trim().length > 0) {
            outputWindow.appendLine(line);
          }
        }
      }
    } catch (e) {
      // logFile might not exist yet — ignore
    }

  }
}

function checkForMissingLockFile(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  
  // Only process Terraform files
  if (document.languageId !== 'terraform') {
    return diagnostics;
  }

  const fullPath = document.fileName.split(path.sep).slice(0, -1).join(path.sep);
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
        'No .terraform.lock.hcl file found. Consider running terraform init.',
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
        'No .terraform.lock.hcl file found. Consider running terraform init.',
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.code = 'tfdocs.missing-lock-file';
      diagnostic.source = 'tfdocs';
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

function updateDiagnostics(document: vscode.TextDocument): void {
  if (diagnosticCollection) {
    const diagnostics = checkForMissingLockFile(document);
    diagnosticCollection.set(document.uri, diagnostics);
  }
}

async function runTerraformInit(document: vscode.TextDocument): Promise<void> {
  const fullPath = document.fileName.split(path.sep).slice(0, -1).join(path.sep);
  
  // Get configuration for Terraform or OpenTofu
  const config = vscode.workspace.getConfiguration('tfdocs');
  const initTool = config.get<string>('initTool', 'terraform');
  const toolName = initTool === 'tofu' ? 'OpenTofu' : 'Terraform';
  const toolCommand = initTool === 'tofu' ? 'tofu' : 'terraform';
  
  const outputWindow = vscode.window.createOutputChannel(`${toolName} Init`);
  outputWindow.show();
  outputWindow.appendLine(`Running ${toolCommand} init -input=false -no-color in ${fullPath}`);

  const terminal = vscode.window.createTerminal({
    name: `${toolName} Init`,
    cwd: fullPath,
    hideFromUser: true,
  });

  const logFilename = `${toolCommand}-init.log`;
  const logFile = `${fullPath}/.terraform/logs/${logFilename}`;
  execSync(`rm ${logFile} || true`);

  terminal.sendText(`mkdir -p .terraform/logs && ${toolCommand} init -input=false -no-color > .terraform/logs/${logFilename}`, true);
  await waitForProcess(logFile, outputWindow);
  outputWindow.appendLine(`Finished initializing`);
  
  // Refresh diagnostics after init completes
  updateDiagnostics(document);
}

class TerraformInitCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    const actions: vscode.CodeAction[] = [];

    // Check if there are any diagnostics for missing lock file
    const relevantDiagnostics = context.diagnostics.filter(
      diagnostic => diagnostic.source === 'tfdocs' && diagnostic.code === 'tfdocs.missing-lock-file'
    );

    if (relevantDiagnostics.length > 0) {
      const config = vscode.workspace.getConfiguration('tfdocs');
      const initTool = config.get<string>('initTool', 'terraform');
      const toolName = initTool === 'tofu' ? 'OpenTofu' : 'Terraform';
      const toolCommand = initTool === 'tofu' ? 'tofu' : 'terraform';

      const action = new vscode.CodeAction(
        `Run ${toolCommand} init`,
        vscode.CodeActionKind.QuickFix
      );
      
      action.command = {
        title: `Run ${toolCommand} init`,
        command: 'tfdocs.runTerraformInit',
        arguments: [document]
      };
      
      action.diagnostics = relevantDiagnostics;
      action.isPreferred = true;
      
      actions.push(action);
    }

    return actions;
  }
}


export async function activate(context: vscode.ExtensionContext) {
  // Create diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection('tfdocs');
  context.subscriptions.push(diagnosticCollection);

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
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/.terraform.lock.hcl');
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

  // Register the terraform init command
  const initCommand = vscode.commands.registerCommand('tfdocs.runTerraformInit', async (document: vscode.TextDocument) => {
    await runTerraformInit(document);
  });

  // Register the code action provider for quick fixes
  const codeActionProvider = new TerraformInitCodeActionProvider();
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { language: 'terraform', scheme: 'file' },
    codeActionProvider,
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }
  );

  const lookupCommand = vscode.commands.registerCommand('tfdocs.lookupResource', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    
    const doc = editor.document;

    if (doc.languageId !== 'terraform') {
      return;
    };

    const action = await getLineData(doc, editor.selection.active);
    
    if (!action) {
      return;
    }
    
    if (action.type === 'url') {
      vscode.env.openExternal(vscode.Uri.parse(action.url));
    } else if (action.type === 'navigate') {
      const doc = await vscode.workspace.openTextDocument(action.filePath);
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(0, 0, 0, 0);
    }
  });
  
  const definitionProvider: vscode.DefinitionProvider = {
    async provideDefinition() {
      const result = await vscode.commands.executeCommand('tfdocs.lookupResource');
      
      if (result) {
        return [];
      }
    }
  };

  context.subscriptions.push(lookupCommand);
  context.subscriptions.push(initCommand);
  context.subscriptions.push(codeActionDisposable);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'terraform', scheme: 'file' },
      definitionProvider
    )
  );
}