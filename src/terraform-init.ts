import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForProcess(
  logFile: string,
  outputWindow: vscode.OutputChannel
): Promise<void> {
  const lines: string[] = [];
  let fileHasNewLines = true;

  // go 3 dirs up, then add /.terraform.lock.hcl
  const lockFile =
    logFile.split('/').slice(0, -3).join('/') + '/.terraform.lock.hcl';

  while (fileHasNewLines || !fs.existsSync(lockFile)) {
    await sleep(fileHasNewLines ? 1000 : 5000);
    fileHasNewLines = false;

    try {
      const newLines = fs.readFileSync(logFile, 'utf-8').split('\n');

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

export async function runTerraformInit(
  document: vscode.TextDocument
): Promise<void> {
  const fullPath = document.fileName
    .split(path.sep)
    .slice(0, -1)
    .join(path.sep);

  // Get configuration for Terraform or OpenTofu
  const config = vscode.workspace.getConfiguration('tfdocs');
  const initTool = config.get<string>('initTool', 'terraform');
  const toolName = initTool === 'tofu' ? 'OpenTofu' : 'Terraform';
  const toolCommand = initTool === 'tofu' ? 'tofu' : 'terraform';

  const outputWindow = vscode.window.createOutputChannel(`${toolName} Init`);
  outputWindow.show();
  outputWindow.appendLine(
    `Running ${toolCommand} init -input=false -no-color in ${fullPath}`
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
    `mkdir -p .terraform/logs && ${toolCommand} init -input=false -no-color > .terraform/logs/${logFilename}`,
    true
  );
  await waitForProcess(logFile, outputWindow);

  let initSucceeded = false;
  try {
    const logContent = fs.readFileSync(logFile, 'utf-8');
    // Check for common success message
    if (
      logContent.includes('Terraform has been successfully initialized') ||
      logContent.includes('OpenTofu has been successfully initialized')
    ) {
      initSucceeded = true;
    }
  } catch (e) {
    // Could not read log file
  }

  if (!initSucceeded) {
    outputWindow.appendLine(
      'Error: Initialization did not complete successfully. Check the log for details.'
    );
    throw new Error('Terraform/OpenTofu init failed');
  }

  outputWindow.appendLine(`Finished initializing`);
}
