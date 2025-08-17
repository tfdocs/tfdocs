import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';
import { getResourceSlug } from './registry';
import { findMainFileInDir } from './filesystem';
import { getAttribute, getProviderSources } from './terraform';
import { parseTerraformLockFile } from './terraform-lock-parser';
import { execSync } from 'child_process';
import { Action, RESOURCE_REGEX, MODULE_REGEX } from './types';
import { waitForProcess, runTerraformInit } from './terraform-init';
import { updateDiagnostics } from './diagnostics';
import { stripAnsiCodes, convertAnsiToVSCode } from './text-formatter';

// Track if the init notification has already been shown this session
let initNotificationShown = false;

async function getResourceData(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<Action | undefined> {
  const line = document.lineAt(position.line).text;
  const match = RESOURCE_REGEX.exec(line);

  if (!match) {
    return undefined;
  }

  const resourceType = match[1] === 'resource' ? 'resources' : 'data-sources';
  const providerNamespaces = await getProviderSources(document);
  const namespace = providerNamespaces[match[2]]?.split('/')[0] ?? 'hashicorp';
  const slug = await getResourceSlug(`${namespace}/${match[2]}`, match[3]);
  const fullPath = document.fileName
    .split(path.sep)
    .slice(0, -1)
    .join(path.sep);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const documentPath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, fullPath)
    : fullPath;
  let providerVersion = 'latest';

  const lockFilePath = `${fullPath}/.terraform.lock.hcl`;

  if (!fs.existsSync(lockFilePath)) {
    // If notification has already been shown this session, don't show it again

    // Get configuration for Terraform or OpenTofu
    const config = vscode.workspace.getConfiguration('tfdocs');
    const initTool = config.get<string>('initTool', 'terraform');
    const enableColorizer = config.get<boolean>('enableColorizer', false);
    const toolName = initTool === 'tofu' ? 'OpenTofu' : 'Terraform';
    const toolCommand = initTool === 'tofu' ? 'tofu' : 'terraform';
    const colorFlag = enableColorizer ? '' : ' -no-color';

    // Mark that we're about to show the notification

    if (!initNotificationShown) {
      const action = await vscode.window.showWarningMessage(
      `No .terraform.lock.hcl file found. This might indicate that ${toolName} has not been initialized.`,
      `Run ${toolCommand} init`,
      'Cancel'
    );

    if (action === `Run ${toolCommand} init`) {
      // Show progress notification that will replace the warning
      return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Running ${toolCommand} init`,
        cancellable: false
      }, async (progress) => {
        const outputWindow = vscode.window.createOutputChannel(
          `${toolName} Init`
        );
        outputWindow.show();
        outputWindow.appendLine(
          `Running ${toolCommand} init -input=false${colorFlag} in ${fullPath}`
        );

        const terminal = vscode.window.createTerminal({
          name: `${toolName} Init`,
          cwd: fullPath,
          hideFromUser: true,
        });

        const logFilename = `${toolCommand}-init.log`;
        const logFile = `${fullPath}/.terraform/logs/${logFilename}`;
        execSync(`rm ${logFile} || true`);

        terminal.sendText(
          `mkdir -p .terraform/logs && ${toolCommand} init -input=false${colorFlag} > .terraform/logs/${logFilename}`,
          true
        );
        
        progress.report({ message: 'Initializing...' });

        try {
          await waitForProcess(
            logFile,
            outputWindow,
            enableColorizer,
            toolCommand
          );

          // Check if initialization was successful by reading the log
          let initSucceeded = false;
          try {
            const logContent = stripAnsiCodes(fs.readFileSync(logFile, 'utf-8'));
            if (
              logContent.includes(
                'Terraform has been successfully initialized'
              ) ||
              logContent.includes('OpenTofu has been successfully initialized')
            ) {
              initSucceeded = true;
              progress.report({ message: 'Completed successfully!' });
            }
          } catch (e) {
            // Could not read log file
          }

          if (!initSucceeded) {
            progress.report({ message: 'Failed - check output for details' });
            return undefined; // Don't proceed with resource lookup if init failed
          }

          outputWindow.appendLine(`Finished initializing`);

          // Check if the lock file was created after initialization
          if (!fs.existsSync(lockFilePath)) {
            return undefined; // Don't proceed with resource lookup if init failed
          }
        } catch (error) {
          progress.report({ message: 'Failed - check output for details' });
          return undefined; // Don't proceed with resource lookup if init failed
        }
      });
    }
    
    }
  }

  try {
    const terraformLockFile = fs.readFileSync(lockFilePath, 'utf-8');
    providerVersion =
      parseTerraformLockFile(terraformLockFile).providers.get(
        `${namespace}/${match[2]}`
      )?.version || 'latest';
  } catch (error) {
    console.warn('Unable to read .terraform.lock.hcl file:', lockFilePath);
    console.warn('Using latest version for resource lookup');
  }

  initNotificationShown = true;


  return {
    type: 'url',
    url: `https://registry.terraform.io/providers/${namespace}/${match[2]}/${providerVersion}/docs/${resourceType}/${slug}`,
  };
}

async function getModuleData(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<Action | undefined> {
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
      vscode.window.showErrorMessage(
        `Could not find main.tf file in ${modulePath}`
      );
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

async function getLineData(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<Action | undefined> {
  let lineData: Action | undefined = await getResourceData(document, position);

  if (!lineData) {
    lineData = await getModuleData(document, position);
  }

  if (!lineData) {
    return undefined;
  }

  return lineData;
}

export function registerCommands(context: vscode.ExtensionContext): void {
  // Register the terraform init command
  const initCommand = vscode.commands.registerCommand(
    'tfdocs.runTerraformInit',
    async (document: vscode.TextDocument) => {
      await runTerraformInit(document);
      // Refresh diagnostics after init completes
      updateDiagnostics(document);
    }
  );

  // Register the lookup resource command
  const lookupCommand = vscode.commands.registerCommand(
    'tfdocs.lookupResource',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const doc = editor.document;

      if (doc.languageId !== 'terraform') {
        return;
      }

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
    }
  );

  // Register a command to handle URL clicks from definition provider
  const openUrlCommand = vscode.commands.registerCommand(
    'tfdocs.openUrl',
    async (uri: vscode.Uri, position: vscode.Position) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const action = await getLineData(document, position);

      if (action && action.type === 'url') {
        vscode.env.openExternal(vscode.Uri.parse(action.url));
      }
    }
  );

  // Register the hover provider for underlines when Ctrl+hovering
  const hoverProvider: vscode.HoverProvider = {
    async provideHover(document, position) {
      const line = document.lineAt(position.line).text;

      // Check if we're hovering over a resource type
      const resourceMatch = RESOURCE_REGEX.exec(line);
      if (resourceMatch) {
        const [fullMatch, resourceKeyword, provider, resourceName] =
          resourceMatch;
        const resourceType = `${provider}_${resourceName}`;

        // Find the position of the resource type in the line
        const resourceTypeStart = line.indexOf(`"${resourceType}"`);
        const resourceTypeEnd = resourceTypeStart + resourceType.length + 2; // +2 for quotes

        // Check if cursor is within the resource type
        if (
          resourceTypeStart !== -1 &&
          position.character >= resourceTypeStart + 1 &&
          position.character <= resourceTypeEnd - 1
        ) {
          const action = await getResourceData(document, position);
          if (action && action.type === 'url') {
            return new vscode.Hover(
              new vscode.MarkdownString(
                `**${resourceType}**\n\n[📖 Open documentation](${action.url})\n\n*Ctrl+Click to open*`
              ),
              new vscode.Range(
                position.line,
                resourceTypeStart + 1,
                position.line,
                resourceTypeEnd - 1
              )
            );
          }
        }
      }

      // Check if we're hovering over a module declaration
      const moduleMatch = MODULE_REGEX.exec(line);
      if (moduleMatch) {
        const moduleKeywordStart = line.indexOf('module');
        const moduleKeywordEnd = moduleKeywordStart + 6; // length of "module"

        // Check if cursor is over the "module" keyword
        if (
          position.character >= moduleKeywordStart &&
          position.character <= moduleKeywordEnd
        ) {
          const action = await getModuleData(document, position);
          if (action) {
            let hoverText = '**Module**\n\n';
            if (action.type === 'url') {
              hoverText += `[📖 Open module documentation](${action.url})\n\n*Ctrl+Click to open*`;
            } else if (action.type === 'navigate') {
              hoverText += `📁 Navigate to local module\n\nPath: \`${action.filePath}\`\n\n*Ctrl+Click to navigate*`;
            }

            return new vscode.Hover(
              new vscode.MarkdownString(hoverText),
              new vscode.Range(
                position.line,
                moduleKeywordStart,
                position.line,
                moduleKeywordEnd
              )
            );
          }
        }
      }

      return null;
    },
  };

  // Register a document link provider for clickable links
  const documentLinkProvider: vscode.DocumentLinkProvider = {
    async provideDocumentLinks(document) {
      const links: vscode.DocumentLink[] = [];

      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        // Check for resource types
        const resourceMatch = RESOURCE_REGEX.exec(text);
        if (resourceMatch) {
          const [fullMatch, resourceKeyword, provider, resourceName] =
            resourceMatch;
          const resourceType = `${provider}_${resourceName}`;
          const resourceTypeStart = text.indexOf(`"${resourceType}"`);

          if (resourceTypeStart !== -1) {
            const action = await getResourceData(
              document,
              new vscode.Position(i, resourceTypeStart + 1)
            );
            if (action && action.type === 'url') {
              const range = new vscode.Range(
                i,
                resourceTypeStart + 1,
                i,
                resourceTypeStart + resourceType.length + 1
              );
              const link = new vscode.DocumentLink(
                range,
                vscode.Uri.parse(action.url)
              );
              links.push(link);
            }
          }
        }

        // Check for modules
        const moduleMatch = MODULE_REGEX.exec(text);
        if (moduleMatch) {
          const moduleKeywordStart = text.indexOf('module');

          if (moduleKeywordStart !== -1) {
            const action = await getModuleData(
              document,
              new vscode.Position(i, moduleKeywordStart)
            );
            if (action && action.type === 'url') {
              const range = new vscode.Range(
                i,
                moduleKeywordStart,
                i,
                moduleKeywordStart + 6
              );
              const link = new vscode.DocumentLink(
                range,
                vscode.Uri.parse(action.url)
              );
              links.push(link);
            }
          }
        }
      }

      return links;
    },
  };

  // Register the definition provider
  const definitionProvider: vscode.DefinitionProvider = {
    async provideDefinition(document, position) {
      const line = document.lineAt(position.line).text;

      // Check if we're hovering over a resource type
      const resourceMatch = RESOURCE_REGEX.exec(line);
      if (resourceMatch) {
        const [fullMatch, resourceKeyword, provider, resourceName] =
          resourceMatch;
        const resourceType = `${provider}_${resourceName}`;

        // Find the position of the resource type in the line
        const resourceTypeStart = line.indexOf(`"${resourceType}"`);
        const resourceTypeEnd = resourceTypeStart + resourceType.length + 2; // +2 for quotes

        // Check if cursor is within the resource type
        if (
          resourceTypeStart !== -1 &&
          position.character >= resourceTypeStart + 1 &&
          position.character <= resourceTypeEnd - 1
        ) {
          const action = await getResourceData(document, position);
          if (action && action.type === 'url') {
            // Return a fake location to enable underlines, but handle the click in a command
            return new vscode.Location(
              document.uri,
              new vscode.Position(position.line, resourceTypeStart + 1)
            );
          }
        }
      }

      // Check if we're hovering over a module declaration
      const moduleMatch = MODULE_REGEX.exec(line);
      if (moduleMatch) {
        const moduleKeywordStart = line.indexOf('module');
        const moduleKeywordEnd = moduleKeywordStart + 6; // length of "module"

        // Check if cursor is over the "module" keyword
        if (
          position.character >= moduleKeywordStart &&
          position.character <= moduleKeywordEnd
        ) {
          const action = await getModuleData(document, position);
          if (action) {
            if (action.type === 'url') {
              // Return a fake location to enable underlines
              return new vscode.Location(
                document.uri,
                new vscode.Position(position.line, moduleKeywordStart)
              );
            } else if (action.type === 'navigate') {
              // Return a location for local module navigation
              const uri = vscode.Uri.file(action.filePath);
              return new vscode.Location(uri, new vscode.Position(0, 0));
            }
          }
        }
      }

      return [];
    },
  };

  const hoverProviderDisposable = vscode.languages.registerHoverProvider(
    { language: 'terraform', scheme: 'file' },
    hoverProvider
  );

  const documentLinkProviderDisposable =
    vscode.languages.registerDocumentLinkProvider(
      { language: 'terraform', scheme: 'file' },
      documentLinkProvider
    );

  const definitionProviderDisposable =
    vscode.languages.registerDefinitionProvider(
      { language: 'terraform', scheme: 'file' },
      definitionProvider
    );

  context.subscriptions.push(lookupCommand);
  context.subscriptions.push(initCommand);
  context.subscriptions.push(openUrlCommand);
  context.subscriptions.push(hoverProviderDisposable);
  context.subscriptions.push(documentLinkProviderDisposable);
  context.subscriptions.push(definitionProviderDisposable);
}
