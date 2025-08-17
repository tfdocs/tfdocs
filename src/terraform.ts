import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

import { findMainFileInDir } from './filesystem';

export async function getProviderSources(
  document: vscode.TextDocument
): Promise<Record<string, string>> {
  const providers: Record<string, string> = {};

  const modulePath = path.join(document.uri.path, '..');
  const mainFile = await findMainFileInDir(modulePath);

  if (!mainFile) {
    return providers;
  }

  const fileStream = fs.createReadStream(mainFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let providerName = '';
  let providerSource = '';

  let inRequiredProviders = false;
  let inProvider = false;

  for await (const line of rl) {
    if (inRequiredProviders) {
      if (inProvider) {
        if (line.trimStart().startsWith('source')) {
          providerSource = line.split('=')[1].trim().slice(1, -1);
        } else if (line.trimEnd().endsWith('}')) {
          providers[providerName] = providerSource;
          inProvider = false;
        }
      } else {
        if (line.trimEnd().endsWith('{')) {
          providerName = line.split('=')[0].trim();
          inProvider = true;
        } else if (line.trimEnd().endsWith('}')) {
          inRequiredProviders = false;
        }
      }
    } else {
      if (line.trimStart().startsWith('required_providers')) {
        inRequiredProviders = true;
      }
    }

    rl.close();
  }

  fileStream.close();

  return providers;
}

export function getAttribute(
  document: vscode.TextDocument,
  position: vscode.Position,
  attribute: string
): string | undefined {
  while (position.line < document.lineCount) {
    position = position.with(position.line + 1);
    const line = document.lineAt(position.line).text;
    if (line.startsWith('}')) {
      return undefined;
    }

    const match = /([a-z0-9_]+)\s+=\s+(.*)/.exec(line);

    if (match && match[1] === attribute) {
      if (match[2].startsWith('"')) {
        return match[2].slice(1, -1);
      }
      return match[2];
    }
  }
}
