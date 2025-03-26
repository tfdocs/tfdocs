import * as vscode from 'vscode';
import * as path from 'path';
import { getResourceSlug } from './registry';
import { findMainFileInDir } from './filesystem';
import { getAttribute, getProviderSources } from './terraform';

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

  return {
    type: 'url',
    url: `https://registry.terraform.io/providers/${namespace}/${match[2]}/latest/docs/${resourceType}/${slug}`,
  };
}

async function getModuleData(document: vscode.TextDocument, position: vscode.Position): Promise<Action | undefined> {
  const line = document.lineAt(position.line).text;
  const match = MODULE_REGEX.exec(line);
  
  console.log('line', line);
  console.log('match', match);
  
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

  if (source.startsWith('.')) {
    const modulePath = path.join(document.uri.path, '..', source);
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
  const lookupCommand = vscode.commands.registerCommand('terraform-docs-navigator.lookupResource', async () => {
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
      const result = await vscode.commands.executeCommand('terraform-docs-navigator.lookupResource');
      
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