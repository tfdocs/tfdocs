import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

export async function findMainFileInDir(
  dirPath: string
): Promise<string | undefined> {
  const files = await fs.promises.readdir(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = await fs.promises.stat(fullPath);

    if (!stat.isFile()) {
      continue;
    }

    const fileStream = fs.createReadStream(fullPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trimStart().startsWith('terraform {')) {
        rl.close();
        fileStream.close();
        return fullPath;
      }
    }
  }

  return undefined;
}
