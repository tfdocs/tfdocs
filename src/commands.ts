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
import { toolName, toolCommand, colorFlag, enableColorizer, useConstraint } from './config';
import { fetchFormattedResourceDocumentation } from './docs-fetcher';

// Regex to match variable assignments in resource blocks
const VARIABLE_REGEX = /^\s*([a-z0-9_]+)\s*=\s*(.*)$/;

// Track if the init notification has already been shown this session
let initNotificationShown = false;

// Cache for provider latest versions to avoid repeated API calls
const providerLatestVersionCache = new Map<string, string>();

// Helper function to parse semantic version into components
interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  original: string;
}

function parseSemanticVersion(version: string): SemanticVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    return null;
  }
  
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    original: version,
  };
}

// Helper function to compare semantic versions
function compareVersions(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  
  // Handle prerelease versions (consider them lower than non-prerelease)
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  
  return 0;
}

// Helper function to check if a version satisfies a constraint
function satisfiesConstraint(version: string, constraint: string): boolean {
  const parsedVersion = parseSemanticVersion(version);
  if (!parsedVersion) return false;
  
  // Handle different constraint formats
  constraint = constraint.trim();
  
  // Exact version (=1.2.3 or 1.2.3)
  if (constraint.startsWith('=') || /^\d+\.\d+\.\d+$/.test(constraint)) {
    const targetVersion = constraint.startsWith('=') ? constraint.slice(1) : constraint;
    return version === targetVersion;
  }
  
  // Greater than or equal (>=1.2.3)
  if (constraint.startsWith('>=')) {
    const targetVersion = parseSemanticVersion(constraint.slice(2));
    return targetVersion ? compareVersions(parsedVersion, targetVersion) >= 0 : false;
  }
  
  // Greater than (>1.2.3)
  if (constraint.startsWith('>') && !constraint.startsWith('>=')) {
    const targetVersion = parseSemanticVersion(constraint.slice(1));
    return targetVersion ? compareVersions(parsedVersion, targetVersion) > 0 : false;
  }
  
  // Less than or equal (<=1.2.3)
  if (constraint.startsWith('<=')) {
    const targetVersion = parseSemanticVersion(constraint.slice(2));
    return targetVersion ? compareVersions(parsedVersion, targetVersion) <= 0 : false;
  }
  
  // Less than (<1.2.3)
  if (constraint.startsWith('<') && !constraint.startsWith('<=')) {
    const targetVersion = parseSemanticVersion(constraint.slice(1));
    return targetVersion ? compareVersions(parsedVersion, targetVersion) < 0 : false;
  }
  
  // Pessimistic constraint (~>1.2.3 means >= 1.2.3 and < 1.3.0)
  if (constraint.startsWith('~>')) {
    const targetVersion = parseSemanticVersion(constraint.slice(2));
    if (!targetVersion) return false;
    
    const isMinimumSatisfied = compareVersions(parsedVersion, targetVersion) >= 0;
    const isMaximumSatisfied = parsedVersion.major === targetVersion.major && 
                              parsedVersion.minor === targetVersion.minor;
    
    return isMinimumSatisfied && isMaximumSatisfied;
  }
  
  // Default: treat as exact match
  return version === constraint;
}

// Helper function to parse constraint versions from lock file constraints
function parseConstraintVersions(constraints: string): string[] {
  console.debug(`Parsing constraint versions from: ${constraints}`);
  
  // Split on commas and process each constraint
  const constraintParts = constraints.split(',').map(c => c.trim());
  const versions: string[] = [];
  
  for (const constraint of constraintParts) {
    // Remove constraint operators (>=, <=, ~>, >, <, =) and extract version
    const versionMatch = constraint.match(/[>=<~]*\s*(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)/);
    if (versionMatch) {
      const version = versionMatch[1];
      if (!versions.includes(version)) {
        versions.push(version);
      }
    }
  }
  
  console.debug(`Extracted versions from constraints: ${versions}`);
  return versions;
}

// Helper function to resolve version based on constraint strategy
function resolveVersionWithConstraint(
  lockFileVersion: string,
  constraints?: string
): string {
  // If no constraints, use the lock file version directly
  if (!constraints) {
    return lockFileVersion;
  }
  
  // If strategy is 'high' (default), skip constraint logic and use lock file version
  if (useConstraint === 'high') {
    console.debug(`Using default strategy 'high', returning lock file version: ${lockFileVersion}`);
    return lockFileVersion;
  }
  
  console.debug(`Resolving version with constraint: ${constraints}, strategy: ${useConstraint}`);
  
  // Parse versions from constraints
  const constraintVersions = parseConstraintVersions(constraints);
  
  // If no versions found in constraints, fall back to lock file version
  if (constraintVersions.length === 0) {
    console.debug('No versions found in constraints, using lock file version');
    return lockFileVersion;
  }
  
  // If only one version in constraints, return it
  if (constraintVersions.length === 1) {
    console.debug(`Only one version in constraints: ${constraintVersions[0]}`);
    return constraintVersions[0];
  }
  
  // Parse and sort versions
  const parsedVersions = constraintVersions
    .map(v => parseSemanticVersion(v))
    .filter(v => v !== null) as SemanticVersion[];
  
  if (parsedVersions.length === 0) {
    console.debug('No valid semantic versions found, using lock file version');
    return lockFileVersion;
  }
  
  // Sort versions in descending order (newest first)
  parsedVersions.sort((a, b) => compareVersions(b, a));
  
  console.debug(`Sorted constraint versions:`, parsedVersions.map(v => v.original));
  
  switch (useConstraint) {
    case 'low':
      // Return the lowest (oldest) version from constraints
      const lowestVersion = parsedVersions[parsedVersions.length - 1].original;
      console.debug(`Selected lowest version: ${lowestVersion}`);
      return lowestVersion;
      
    case 'middle':
      // Return the middle version from constraints
      const midIndex = Math.floor(parsedVersions.length / 2);
      const middleVersion = parsedVersions[midIndex].original;
      console.debug(`Selected middle version: ${middleVersion}`);
      return middleVersion;
      
    default:
      // Fallback to lock file version for any unknown strategy
      console.debug(`Unknown strategy '${useConstraint}', using lock file version`);
      return lockFileVersion;
  }
}

// Helper function to fetch the latest version of a provider from Terraform registry
async function getLatestProviderVersion(namespace: string, providerName: string): Promise<string | null> {
  const cacheKey = `${namespace}/${providerName}`;
  
  // Check cache first
  if (providerLatestVersionCache.has(cacheKey)) {
    return providerLatestVersionCache.get(cacheKey) || null;
  }

  try {
    const url = `https://registry.terraform.io/v2/providers/${namespace}/${providerName}?include=provider-versions`;
    console.debug(`Fetching latest version for ${cacheKey} from: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch provider versions for ${cacheKey}: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    
    // Find the latest version from the included provider-versions
    let latestVersion = null;
    let latestDate = null;
    
    if (data.included && Array.isArray(data.included)) {
      for (const versionInfo of data.included) {
        if (versionInfo.type === 'provider-versions' && versionInfo.attributes) {
          const publishedAt = new Date(versionInfo.attributes['published-at']);
          const version = versionInfo.attributes.version;
          
          if (!latestDate || publishedAt > latestDate) {
            latestDate = publishedAt;
            latestVersion = version;
          }
        }
      }
    }
    
    if (latestVersion) {
      console.debug(`Latest version for ${cacheKey}: ${latestVersion}`);
      providerLatestVersionCache.set(cacheKey, latestVersion);
      return latestVersion;
    }
    
    console.warn(`No versions found for provider ${cacheKey}`);
    return null;
  } catch (error) {
    console.warn(`Error fetching latest version for ${cacheKey}:`, error);
    return null;
  }
}

// Helper function to find the resource block context for a given position
function findResourceContext(
  document: vscode.TextDocument,
  position: vscode.Position
): { resourceMatch: RegExpExecArray; resourceStartLine: number } | null {
  // Search backwards from current position to find the resource declaration
  for (let lineNum = position.line; lineNum >= 0; lineNum--) {
    const line = document.lineAt(lineNum).text;
    const resourceMatch = RESOURCE_REGEX.exec(line);
    
    if (resourceMatch) {
      // Found a resource declaration, now check if our position is within this resource block
      let braceCount = 0;
      let foundOpenBrace = false;
      
      for (let checkLine = lineNum; checkLine <= position.line && checkLine < document.lineCount; checkLine++) {
        const checkText = document.lineAt(checkLine).text;
        
        // Count braces to determine if we're inside the resource block
        for (const char of checkText) {
          if (char === '{') {
            braceCount++;
            foundOpenBrace = true;
          } else if (char === '}') {
            braceCount--;
            if (foundOpenBrace && braceCount === 0 && checkLine < position.line) {
              // We've closed the resource block before reaching our position
              return null;
            }
          }
        }
        
        // If we've reached our position and we're inside the resource block
        if (checkLine === position.line && foundOpenBrace && braceCount > 0) {
          return { resourceMatch, resourceStartLine: lineNum };
        }
      }
    }
  }
  
  return null;
}

// Helper function to extract variable name from a line at a given position
function getVariableAtPosition(
  line: string,
  position: vscode.Position
): string | null {
  const match = VARIABLE_REGEX.exec(line);
  if (!match) {
    return null;
  }
  
  const variableName = match[1];
  const assignmentStart = line.indexOf(variableName);
  const assignmentEnd = assignmentStart + variableName.length;
  
  // Check if cursor is within the variable name
  if (position.character >= assignmentStart && position.character <= assignmentEnd) {
    return variableName;
  }
  
  return null;
}

// Helper function to calculate the nesting level and generate the appropriate hash
function generateVariableHash(
  document: vscode.TextDocument,
  position: vscode.Position,
  variableName: string
): string {
  // Count the nesting level by counting opening braces from the resource start
  const resourceContext = findResourceContext(document, position);
  if (!resourceContext) {
    return variableName;
  }

  let nestingLevel = 1;
  let foundResourceBrace = false;
  
  // Start from the resource declaration line and count braces up to our position
  for (let lineNum = resourceContext.resourceStartLine; lineNum <= position.line; lineNum++) {
    const line = document.lineAt(lineNum).text;
    
    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      
      if (char === '{') {
        if (!foundResourceBrace) {
          foundResourceBrace = true; // This is the resource block opening brace
        } else {
          nestingLevel++; // This is a nested block
        }
      } else if (char === '}') {
        if (foundResourceBrace && nestingLevel > 0) {
          nestingLevel--;
        }
      }
      
      // If we've reached our position, stop counting
      if (lineNum === position.line && charIndex >= position.character) {
        break;
      }
    }
  }
  
  // Generate hash based on nesting level
  if (nestingLevel > 0) {
    console.debug(`Variable ${variableName} at nesting level ${nestingLevel}, hash: ${variableName}-${nestingLevel}`);
    return `${variableName}-${nestingLevel}`;
  } else {
    console.debug(`Variable ${variableName} at root level, hash: ${variableName}`);
    return variableName;
  }
}

async function getResourceData(
  document: vscode.TextDocument,
  position: vscode.Position,
  variableName?: string
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

    // Mark that we're about to show the notification

    if (!initNotificationShown) {
      const action = await vscode.window.showWarningMessage(
        `No .terraform.lock.hcl file found. This might indicate that ${toolName} has not been initialized.`,
        `Run ${toolCommand} init`,
        'Cancel'
      );

      if (action === `Run ${toolCommand} init`) {
        // Show progress notification that will replace the warning
        return vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Running ${toolCommand} init`,
            cancellable: false,
          },
          async progress => {
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
                const logContent = stripAnsiCodes(
                  fs.readFileSync(logFile, 'utf-8')
                );
                if (
                  logContent.includes(
                    'Terraform has been successfully initialized'
                  ) ||
                  logContent.includes(
                    'OpenTofu has been successfully initialized'
                  )
                ) {
                  initSucceeded = true;
                  progress.report({ message: 'Completed successfully!' });
                }
              } catch (e) {
                // Could not read log file
              }

              if (!initSucceeded) {
                progress.report({
                  message: 'Failed - check output for details',
                });
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
          }
        );
      }
    }
  }

  try {
    const terraformLockFile = fs.readFileSync(lockFilePath, 'utf-8');
    const parsedLockFile = parseTerraformLockFile(terraformLockFile);
    const providerInfo = parsedLockFile.providers.get(`${namespace}/${match[2]}`);
    providerVersion = providerInfo?.version || 'latest';
    
    // Apply constraint strategy if constraints are available and strategy is not default
    if (providerInfo?.constraints && providerVersion !== 'latest' && useConstraint !== 'high') {
      console.debug(`Lock file version: ${providerVersion}, constraints: ${providerInfo.constraints}`);
      providerVersion = resolveVersionWithConstraint(
        providerVersion,
        providerInfo.constraints
      );
      console.debug(`Resolved version with constraint strategy '${useConstraint}': ${providerVersion}`);
    }
  } catch (error) {
    console.warn('Unable to read .terraform.lock.hcl file:', lockFilePath);
    console.warn('Using latest version for resource lookup');
    providerVersion = 'latest';
  }

  initNotificationShown = true;
  
  // Determine if we should use 'latest' or the specific version number in the URL
  let urlVersion = providerVersion;
  if (providerVersion !== 'latest') {
    // Check if the current version is actually the latest available
    const latestVersion = await getLatestProviderVersion(namespace, match[2]);
    if (latestVersion && providerVersion === latestVersion) {
      // Use 'latest' in URL to avoid redirect issues with hash fragments
      urlVersion = 'latest';
      console.debug(`Provider version ${providerVersion} is latest, using 'latest' in URL`);
    } else {
      console.debug(`Provider version ${providerVersion} is not latest (latest: ${latestVersion}), using specific version in URL`);
    }
  }
  
  const baseUrl = `https://registry.terraform.io/providers/${namespace}/${match[2]}/${urlVersion}/docs/${resourceType}/${slug}`;
  const url = variableName ? `${baseUrl}#${variableName}` : baseUrl;

  console.debug('Using provider version:', providerVersion);
  console.debug('Using URL version:', urlVersion);
  console.debug('Using namespace:', namespace);
  console.debug('Using resource type:', resourceType);
  console.debug('Using slug:', slug);
  console.debug('Using URL:', url);
  if (variableName) {
    console.debug('Using variable hash:', variableName);
  }

  return {
    type: 'url',
    url: url,
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
    lineData = await getVariableData(document, position);
  }

  if (!lineData) {
    return undefined;
  }

  return lineData;
}

async function getVariableData(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<Action | undefined> {
  const line = document.lineAt(position.line).text;
  
  // Check if we're on a variable assignment line
  const variableName = getVariableAtPosition(line, position);
  if (!variableName) {
    return undefined;
  }
  
  // Find the resource context for this variable
  const resourceContext = findResourceContext(document, position);
  if (!resourceContext) {
    return undefined;
  }
  
  // Generate the appropriate hash for this variable based on its nesting level
  const variableHash = generateVariableHash(document, position, variableName);
  
  // Get the resource data with the variable hash
  return await getResourceData(document, new vscode.Position(resourceContext.resourceStartLine, 0), variableHash);
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
        console.debug('Opening URL:', action.url);
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
      const action = await getResourceData(document, position);

      if (action && action.type === 'url') {
        console.debug('Opening URL:', action.url);
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
            // Get provider info for display
            const providerNamespaces = await getProviderSources(document);
            const namespace = providerNamespaces[provider]?.split('/')[0] ?? 'hashicorp';
            
            // Get provider version from lock file
            const fullPath = document.fileName.split(path.sep).slice(0, -1).join(path.sep);
            const lockFilePath = `${fullPath}/.terraform.lock.hcl`;
            let providerVersion = 'latest';
            
            try {
              if (fs.existsSync(lockFilePath)) {
                const terraformLockFile = fs.readFileSync(lockFilePath, 'utf-8');
                const parsedLockFile = parseTerraformLockFile(terraformLockFile);
                const providerInfo = parsedLockFile.providers.get(`${namespace}/${provider}`);
                providerVersion = providerInfo?.version || 'latest';
                
                // Apply constraint strategy if constraints are available and strategy is not default
                if (providerInfo?.constraints && providerVersion !== 'latest' && useConstraint !== 'high') {
                  providerVersion = resolveVersionWithConstraint(
                    providerVersion,
                    providerInfo.constraints
                  );
                }
              }
            } catch (error) {
              // Use latest if we can't read the lock file
            }

            const resourceTypeDisplay = resourceKeyword === 'resource' ? 'Resource' : 'Data Source';
            
            let hoverContent = `**${resourceType}**\n\n`;
            hoverContent += `📋 **Type:** ${resourceTypeDisplay}\n`;
            hoverContent += `📦 **Provider:** \`${namespace}/${provider}\`\n`;
            hoverContent += `🏷️ **Version:** \`${providerVersion}\`\n\n`;

            // Try to fetch schema documentation
            try {
              console.debug('Attempting to fetch schema documentation for:', resourceType, 'in', fullPath);
              const docContent = await fetchFormattedResourceDocumentation(
                fullPath,
                resourceKeyword,
                resourceType
              );
              
              console.debug('Schema documentation result:', docContent);
              
              if (docContent && docContent.trim()) {
                console.debug('Formatted documentation content:', docContent);
                hoverContent += `---\n\n**📚 TF Docs**\n\n${docContent}\n`;
              } else {
                console.debug('No schema documentation found');
              }
            } catch (error) {
              // Silently fail and just show basic info
              console.debug('Failed to fetch schema documentation:', error);
            }

            return new vscode.Hover(
              new vscode.MarkdownString(hoverContent),
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

      // Check if we're hovering over a variable in a resource block
      const variableName = getVariableAtPosition(line, position);
      if (variableName) {
        const resourceContext = findResourceContext(document, position);
        if (resourceContext) {
          const action = await getVariableData(document, position);
          if (action && action.type === 'url') {
            const variableHash = generateVariableHash(document, position, variableName);
            let hoverContent = `**${variableName}**\n\n`;
            hoverContent += `🔗 **Variable in resource block**\n`;
            hoverContent += `📍 **Hash:** \`#${variableHash}\`\n\n`;
            hoverContent += `*Ctrl+Click to open documentation with this variable highlighted*`;

            const variableStart = line.indexOf(variableName);
            const variableEnd = variableStart + variableName.length;

            return new vscode.Hover(
              new vscode.MarkdownString(hoverContent),
              new vscode.Range(
                position.line,
                variableStart,
                position.line,
                variableEnd
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

        // Check for variables in resource blocks
        const variableMatch = VARIABLE_REGEX.exec(text);
        if (variableMatch) {
          const variableName = variableMatch[1];
          const variableStart = text.indexOf(variableName);
          
          if (variableStart !== -1) {
            const positionAtVariable = new vscode.Position(i, variableStart + Math.floor(variableName.length / 2));
            const resourceContext = findResourceContext(document, positionAtVariable);
            if (resourceContext) {
              const action = await getVariableData(document, positionAtVariable);
              if (action && action.type === 'url') {
                const range = new vscode.Range(
                  i,
                  variableStart,
                  i,
                  variableStart + variableName.length
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

      // Check if we're hovering over a variable in a resource block
      const variableName = getVariableAtPosition(line, position);
      if (variableName) {
        const resourceContext = findResourceContext(document, position);
        if (resourceContext) {
          const action = await getVariableData(document, position);
          if (action && action.type === 'url') {
            // Return a fake location to enable underlines
            const variableStart = line.indexOf(variableName);
            return new vscode.Location(
              document.uri,
              new vscode.Position(position.line, variableStart)
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
