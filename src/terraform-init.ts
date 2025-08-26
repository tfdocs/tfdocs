import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { stripAnsiCodes, convertAnsiToVSCode } from './text-formatter';
import { toolName, toolCommand, colorFlag, enableColorizer } from './config';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForProcess(
  logFile: string,
  outputWindow: vscode.OutputChannel,
  enableColorizer: boolean = false,
  toolCommand: string = 'terraform'
): Promise<void> {
  const lines: string[] = [];
  const maxMilliseconds = 30000;
  let currentMilliseconds = -1;
  let replaceLine = false;
  let lastLineWasErrorBlock = false;

  const lockFilePath = logFile.split('/').slice(0, -3).join('/');
  const lockFile = lockFilePath + '/.terraform.lock.hcl';
  const colorFlag = enableColorizer ? '' : ' -no-color';

  while (!fs.existsSync(lockFile) && currentMilliseconds < maxMilliseconds) {
    await sleep(currentMilliseconds == 0 ? 1000 : 5000);
    currentMilliseconds =
      currentMilliseconds === -1 ? 0 : currentMilliseconds + 5000;

    try {
      const newLines = fs.readFileSync(logFile, 'utf-8').split('\n');

      if (newLines.length > lines.length) {
        currentMilliseconds = -1;

        const diff = newLines.slice(lines.length).map(line => {
          const trimmed = line.trim();
          return enableColorizer ? convertAnsiToVSCode(trimmed) : trimmed;
        });
        lines.push(...diff);

        for (const line of diff) {
          if (line.length > 0) {
            // Check if this line starts an error block (has Error: keyword)
            const isErrorLine =
              line.startsWith('[ERROR]') || /Error:/i.test(line);
            const isErrorStart = isErrorLine && /Error:/i.test(line); // Only lines with "Error:" keyword
            const isBoxLine = line.includes('│');

            // Add spacing between error blocks - when we see a new "Error:" after completing a previous error block
            if (isErrorStart && lastLineWasErrorBlock) {
              if (replaceLine) {
                outputWindow.replace(
                  `Running ${toolCommand} init -input=false${colorFlag} in ${lockFilePath}\n` +
                    lines.filter(line => line.length > 0).join('\n')
                );
                replaceLine = false;
              } else {
                outputWindow.appendLine(line);
              }
            } else {
              if (replaceLine) {
                outputWindow.replace(
                  `Running ${toolCommand} init -input=false${colorFlag} in ${lockFilePath}\n` +
                    lines.filter(line => line.length > 0).join('\n')
                );
                replaceLine = false;
              } else {
                outputWindow.appendLine(line);
              }
            }

            // Track if we're in an error block
            if (isErrorStart) {
              lastLineWasErrorBlock = true;
            } else if (isBoxLine) {
              // Continue the error block if we're seeing box characters
              // lastLineWasErrorBlock stays the same
            } else if (line.includes('╵')) {
              // End of error block
              lastLineWasErrorBlock = false;
            } else if (!isErrorLine && !isBoxLine) {
              // Non-error, non-box line - end the error block
              lastLineWasErrorBlock = false;
            }
          }
        }
      }
    } catch (e) {
      // logFile might not exist yet — ignore
    }

    if (currentMilliseconds >= 5000) {
      if (replaceLine) {
        outputWindow.replace(
          `Running ${toolCommand} init -input=false${colorFlag} in ${lockFilePath}\n` +
            lines.filter(line => line.length > 0).join('\n') +
            `\n` +
            `waiting for process to finish... (${currentMilliseconds / 1000}s)`
        );
      } else {
        outputWindow.appendLine(
          `waiting for process to finish... (${currentMilliseconds / 1000}s)`
        );
        replaceLine = true;
      }
    }
  }

  outputWindow.appendLine('');
}

export async function runTerraformInit(
  document: vscode.TextDocument
): Promise<void> {
  const fullPath = document.fileName
    .split(path.sep)
    .slice(0, -1)
    .join(path.sep);

  // Get configuration from config module
  const outputWindow = vscode.window.createOutputChannel(`${toolName} Init`);
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
  await waitForProcess(logFile, outputWindow, enableColorizer(), toolCommand());

  let initSucceeded = false;
  try {
    const logContent = stripAnsiCodes(fs.readFileSync(logFile, 'utf-8'));
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
      'Error: Initialization did not complete successfully'
    );
    throw new Error(`${toolCommand} init failed`);
  }

  outputWindow.appendLine(`Finished initializing`);
}
