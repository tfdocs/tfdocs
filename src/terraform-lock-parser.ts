/**
 * Terraform Lock File Parser
 *
 * Parses .terraform.lock.hcl files to extract provider information
 */

export interface TerraformProvider {
  /** The provider source (e.g., "hashicorp/aws") */
  source: string;
  /** The provider version */
  version: string;
  /** List of version constraints */
  constraints?: string;
  /** Content hashes for verification */
  hashes: string[];
  /** Supported platforms */
  platforms?: string[];
}

export interface TerraformLockFile {
  /** Map of provider source to provider information */
  providers: Map<string, TerraformProvider>;
}

/**
 * Parses a Terraform lock file content and extracts provider information
 * @param content The content of the .terraform.lock.hcl file
 * @returns Parsed lock file data
 */
export function parseTerraformLockFile(content: string): TerraformLockFile {
  const providers = new Map<string, TerraformProvider>();

  // Remove comments
  const cleanContent = content.replace(/#.*$/gm, '');

  // Match provider blocks using regex
  const providerRegex =
    /provider\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;

  let match;
  while ((match = providerRegex.exec(cleanContent)) !== null) {
    const providerSource = match[1].replace(/[\w-]*(\.[\w-]*)*\.\w*\//, '');
    const providerBlock = match[2];

    const provider: TerraformProvider = {
      source: providerSource,
      version: '',
      hashes: [],
    };

    // Extract version
    const versionMatch = providerBlock.match(/version\s*=\s*"([^"]+)"/);
    if (versionMatch) {
      provider.version = versionMatch[1];
    }

    // Extract constraints
    const constraintsMatch = providerBlock.match(/constraints\s*=\s*"([^"]+)"/);
    if (constraintsMatch) {
      provider.constraints = constraintsMatch[1];
    }

    // Extract hashes
    const hashesMatch = providerBlock.match(/hashes\s*=\s*\[([\s\S]*?)\]/);
    if (hashesMatch) {
      const hashContent = hashesMatch[1];
      const hashMatches = hashContent.match(/"([^"]+)"/g);
      if (hashMatches) {
        provider.hashes = hashMatches.map(hash => hash.replace(/"/g, ''));
      }
    }

    // Extract platforms
    const platformsMatch = providerBlock.match(
      /platforms\s*=\s*\[([\s\S]*?)\]/
    );
    if (platformsMatch) {
      const platformContent = platformsMatch[1];
      const platformMatches = platformContent.match(/"([^"]+)"/g);
      if (platformMatches) {
        provider.platforms = platformMatches.map(platform =>
          platform.replace(/"/g, '')
        );
      }
    }

    providers.set(providerSource, provider);
  }

  return { providers };
}

/**
 * Parses a Terraform lock file from file path
 * @param filePath Path to the .terraform.lock.hcl file
 * @returns Parsed lock file data
 */
export async function parseTerraformLockFileFromPath(
  filePath: string
): Promise<TerraformLockFile> {
  const fs = await import('fs');
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return parseTerraformLockFile(content);
}

/**
 * Gets all provider sources from a lock file
 * @param lockFile Parsed lock file data
 * @returns Array of provider sources
 */
export function getProviderSources(lockFile: TerraformLockFile): string[] {
  return Array.from(lockFile.providers.keys());
}

/**
 * Gets a specific provider by source
 * @param lockFile Parsed lock file data
 * @param source Provider source (e.g., "hashicorp/aws")
 * @returns Provider information or undefined if not found
 */
export function getProvider(
  lockFile: TerraformLockFile,
  source: string
): TerraformProvider | undefined {
  return lockFile.providers.get(source);
}

/**
 * Gets all providers as an array
 * @param lockFile Parsed lock file data
 * @returns Array of all providers
 */
export function getAllProviders(
  lockFile: TerraformLockFile
): TerraformProvider[] {
  return Array.from(lockFile.providers.values());
}

/**
 * Checks if a provider exists in the lock file
 * @param lockFile Parsed lock file data
 * @param source Provider source to check
 * @returns True if provider exists
 */
export function hasProvider(
  lockFile: TerraformLockFile,
  source: string
): boolean {
  return lockFile.providers.has(source);
}

/**
 * Gets provider by partial name match (useful for finding providers by short name)
 * @param lockFile Parsed lock file data
 * @param partialName Partial provider name (e.g., "aws" for "hashicorp/aws")
 * @returns Array of matching providers
 */
export function findProvidersByName(
  lockFile: TerraformLockFile,
  partialName: string
): TerraformProvider[] {
  const results: TerraformProvider[] = [];

  for (const [source, provider] of lockFile.providers) {
    if (
      source.toLowerCase().includes(partialName.toLowerCase()) ||
      source.split('/').pop()?.toLowerCase().includes(partialName.toLowerCase())
    ) {
      results.push(provider);
    }
  }

  return results;
}

/**
 * Formats provider information for display
 * @param provider Provider to format
 * @returns Formatted string
 */
export function formatProvider(provider: TerraformProvider): string {
  let result = `Provider: ${provider.source}\n`;
  result += `Version: ${provider.version}\n`;

  if (provider.constraints) {
    result += `Constraints: ${provider.constraints}\n`;
  }

  if (provider.platforms && provider.platforms.length > 0) {
    result += `Platforms: ${provider.platforms.join(', ')}\n`;
  }

  if (provider.hashes.length > 0) {
    result += `Hashes: ${provider.hashes.length} hash(es)\n`;
  }

  return result;
}
