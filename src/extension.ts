import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';
import { getResourceSlug } from './registry';
import { findMainFileInDir } from './filesystem';
import { getAttribute, getProviderSources } from './terraform';
import { parseTerraformLockFile } from './terraform-lock-parser';

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
  const documentPath = document.fileName.split(path.sep).slice(0, -1).join(path.sep);
  let providerVersion = "latest";

  const lockFilePath = `${documentPath}/.terraform.lock.hcl`;
  
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
      const terminal = vscode.window.createTerminal({
        name: `${toolName} Init`,
        cwd: documentPath
      });
      terminal.sendText(`${toolCommand} init`);
      terminal.show();
    }
  } else {
    try {
      const terraformLockFile = fs.readFileSync(lockFilePath, 'utf-8');
      providerVersion = parseTerraformLockFile(terraformLockFile).providers.get(`${namespace}/${match[2]}`)?.version || "latest";
    } catch (error) {
      console.warn('Unable to read .terraform.lock.hcl file:', lockFilePath);
      console.warn('Using latest version for resource lookup');
    }
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

export async function activate(context: vscode.ExtensionContext) {
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
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'terraform', scheme: 'file' },
      definitionProvider
    )
  );
}