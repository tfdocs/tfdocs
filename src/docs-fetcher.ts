/**
 * Documentation fetcher using Terraform/OpenTofu provider schema
 * 
 * Fetches resource documentation from provider schema command
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { toolCommand } from './config';

interface TerraformAttribute {
  type: string | string[];
  description?: string;
  description_kind?: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  sensitive?: boolean;
}

interface TerraformBlock {
  attributes?: { [key: string]: TerraformAttribute };
  block_types?: { [key: string]: any };
  description?: string;
  description_kind?: string;
  nesting_mode?: string;
  min_items?: number;
  max_items?: number;
  block?: TerraformBlock; // Nested block definition
}

interface TerraformResourceSchema {
  version: number;
  block: TerraformBlock;
}

interface TerraformProviderSchema {
  resource_schemas?: { [key: string]: TerraformResourceSchema };
  data_source_schemas?: { [key: string]: TerraformResourceSchema };
}

interface TerraformSchema {
  format_version: string;
  provider_schemas: { [key: string]: TerraformProviderSchema };
}

interface TerraformDocumentation {
  description?: string;
  arguments?: { [key: string]: TerraformAttribute };
  attributes?: { [key: string]: TerraformAttribute };
  blocks?: { [key: string]: TerraformBlock };
  required_args?: string[];
  optional_args?: string[];
  required_blocks?: string[];
  optional_blocks?: string[];
}

/**
 * Cache for schema data to avoid repeated command executions
 */
const schemaCache = new Map<string, TerraformSchema | null>();

/**
 * Fetches formatted documentation for a Terraform resource from provider schema
 * @param workingDirectory The directory containing the terraform configuration
 * @param resourceType The resource type ("resource" or "data")
 * @param resourceName The full resource name (e.g., "rabbitmq_exchange")
 * @returns Promise<string | null> - Formatted markdown string ready for display
 */
export async function fetchFormattedResourceDocumentation(
  workingDirectory: string,
  resourceType: string,
  resourceName: string
): Promise<string | null> {
  // Try to load formatted documentation from cache first
  const cachedFormatted = await loadCachedFormattedDocumentation(workingDirectory, resourceType, resourceName);
  if (cachedFormatted) {
    return cachedFormatted;
  }

  // If not cached, fetch and parse the schema
  const docs = await fetchResourceDocumentation(workingDirectory, resourceType, resourceName);
  if (!docs) {
    return null;
  }

  // Format and return the documentation
  return formatDocumentationForHover(docs, resourceName);
}

/**
 * Fetches documentation for a Terraform resource from provider schema
 * @param workingDirectory The directory containing the terraform configuration
 * @param resourceType The resource type ("resource" or "data")
 * @param resourceName The full resource name (e.g., "rabbitmq_exchange")
 * @returns Promise<TerraformDocumentation | null>
 */
export async function fetchResourceDocumentation(
  workingDirectory: string,
  resourceType: string,
  resourceName: string
): Promise<TerraformDocumentation | null> {
  const cacheKey = workingDirectory;
  
  // Check if we have a lock file first
  const lockFilePath = path.join(workingDirectory, '.terraform.lock.hcl');
  if (!fs.existsSync(lockFilePath)) {
    console.debug('No .terraform.lock.hcl file found, cannot fetch schema');
    return null;
  }

  // Try to load from disk cache first
  const cachedDocs = await loadCachedDocumentation(workingDirectory, resourceType, resourceName);
  if (cachedDocs) {
    console.debug('Using cached documentation for', resourceName);
    return cachedDocs;
  }

  let schema: TerraformSchema | null = null;
  
  // Check memory cache
  if (schemaCache.has(cacheKey)) {
    schema = schemaCache.get(cacheKey) || null;
  } else {
    // Fetch schema from terraform/tofu
    schema = await fetchProviderSchema(workingDirectory);
    schemaCache.set(cacheKey, schema);
  }

  if (!schema) {
    return null;
  }

  // Find the resource in the schema
  for (const [providerKey, providerSchema] of Object.entries(schema.provider_schemas)) {
    const schemas = resourceType === 'resource' 
      ? providerSchema.resource_schemas 
      : providerSchema.data_source_schemas;
    
    if (schemas && schemas[resourceName]) {
      const resourceSchema = schemas[resourceName];
      const docs = parseResourceSchema(resourceSchema, resourceName);
      
      // Cache the documentation to disk
      await saveCachedDocumentation(workingDirectory, resourceType, resourceName, docs, providerKey);
      
      return docs;
    }
  }

  return null;
}

/**
 * Fetches the provider schema using terraform/tofu providers schema command
 * @param workingDirectory The directory to run the command in
 * @returns Promise<TerraformSchema | null>
 */
async function fetchProviderSchema(workingDirectory: string): Promise<TerraformSchema | null> {
  try {
    console.debug(`Fetching provider schema from ${workingDirectory}`);
    
    const command = `${toolCommand} providers schema -json`;
    console.debug(`Running command: ${command}`);
    
    // Create a temporary file to capture output
    const tempFile = path.join(workingDirectory, '.terraform', 'schema-output.json');
    
    // Ensure .terraform directory exists
    const terraformDir = path.join(workingDirectory, '.terraform');
    if (!fs.existsSync(terraformDir)) {
      fs.mkdirSync(terraformDir, { recursive: true });
    }

    // Create terminal to run the schema command
    const terminal = vscode.window.createTerminal({
      name: 'TF Docs Schema',
      cwd: workingDirectory,
      hideFromUser: false // Show for debugging
    });

    // Run command and redirect output to file
    const fullCommand = `${command} > "${tempFile}" 2>&1`;
    terminal.sendText(fullCommand, true);

    // Wait for the command to complete by polling for the output file
    const output = await waitForSchemaOutput(tempFile, 10000); // 10 second timeout
    
    // Clean up the terminal
    terminal.dispose();

    if (!output) {
      console.warn('No schema output received');
      return null;
    }

    console.debug('Schema output length:', output.length);
    console.debug('Schema output preview:', output.substring(0, 200));

    const schema: TerraformSchema = JSON.parse(output);
    return schema;
  } catch (error) {
    console.warn(`Error fetching provider schema:`, error);
    return null;
  }
}

/**
 * Waits for schema output file to be created and returns its content
 * @param filePath Path to the output file
 * @param timeout Timeout in milliseconds
 * @returns Promise<string | null>
 */
function waitForSchemaOutput(filePath: string, timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    const checkFile = () => {
      if (Date.now() - startTime > timeout) {
        console.warn('Timeout waiting for schema output');
        resolve(null);
        return;
      }

      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          // Check if content looks like JSON (starts with { or [)
          if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
            // Clean up the temp file
            try {
              fs.unlinkSync(filePath);
            } catch (e) {
              // Ignore cleanup errors
            }
            resolve(content);
            return;
          }
        } catch (error) {
          // File might still be being written, continue polling
        }
      }

      setTimeout(checkFile, checkInterval);
    };

    checkFile();
  });
}

/**
 * Parses a resource schema to extract documentation information
 * @param resourceSchema The resource schema from terraform
 * @param resourceName The resource name for context
 * @returns TerraformDocumentation
 */
function parseResourceSchema(
  resourceSchema: TerraformResourceSchema,
  resourceName: string
): TerraformDocumentation {
  const docs: TerraformDocumentation = {
    arguments: {},
    attributes: {},
    blocks: {},
    required_args: [],
    optional_args: [],
    required_blocks: [],
    optional_blocks: []
  };

  // Extract description from the resource block
  if (resourceSchema.block.description) {
    docs.description = resourceSchema.block.description;
  }

  // Extract attributes
  if (resourceSchema.block.attributes) {
    for (const [attrName, attr] of Object.entries(resourceSchema.block.attributes)) {
      // Skip computed-only attributes for arguments
      if (attr.required || attr.optional) {
        docs.arguments![attrName] = attr;
        
        if (attr.required) {
          docs.required_args!.push(attrName);
        } else if (attr.optional) {
          docs.optional_args!.push(attrName);
        }
      }
      
      // All attributes go in the attributes section
      docs.attributes![attrName] = attr;
    }
  }

  // Extract block types (like "settings", "tags", etc.)
  if (resourceSchema.block.block_types) {
    for (const [blockName, blockDef] of Object.entries(resourceSchema.block.block_types)) {
      docs.blocks![blockName] = blockDef;
      
      // In Terraform, blocks are typically optional unless explicitly required
      // We'll be conservative and assume blocks are optional by default
      // A block might be considered "required" if it has min_items > 0 AND all its attributes are required
      let isRequired = false;
      
      if (blockDef.min_items && blockDef.min_items > 0 && blockDef.block?.attributes) {
        // Check if ALL attributes in the block are required
        const allAttrsRequired = Object.values(blockDef.block.attributes).every(
          (attr: any) => attr.required === true
        );
        // Only consider the block required if min_items > 0 AND all attributes are required
        isRequired = allAttrsRequired;
      }
      
      if (isRequired) {
        docs.required_blocks!.push(blockName);
      } else {
        docs.optional_blocks!.push(blockName);
      }
    }
  }

  return docs;
}

/**
 * Formats documentation for display in hover tooltip
 * @param docs The documentation object
 * @param resourceName The resource name
 * @returns Formatted markdown string
 */
export function formatDocumentationForHover(
  docs: TerraformDocumentation,
  resourceName: string
): string {
  let content = '';

  // Add description if available
  if (docs.description) {
    content += `${docs.description}\n\n`;
  }

  // Add required arguments
  if (docs.required_args && docs.required_args.length > 0) {
    content += `**Required Arguments:**\n`;
    docs.required_args.slice(0, 3).forEach(arg => {
      const attr = docs.arguments![arg];
      const typeStr = Array.isArray(attr.type) ? attr.type.join('|') : attr.type;
      content += `- \`${arg}\` (${typeStr})`;
      if (attr.description) {
        // Truncate description for hover
        const desc = attr.description.length > 60 
          ? attr.description.substring(0, 60) + '...' 
          : attr.description;
        content += ` - ${desc}`;
      }
      content += '\n';
    });
    
    if (docs.required_args.length > 3) {
      content += `- ... and ${docs.required_args.length - 3} more\n`;
    }
    content += '\n';
  }

  // Add a few optional arguments
  if (docs.optional_args && docs.optional_args.length > 0) {
    content += `**Optional Arguments:**\n`;
    docs.optional_args.slice(0, 2).forEach(arg => {
      const attr = docs.arguments![arg];
      const typeStr = Array.isArray(attr.type) ? attr.type.join('|') : attr.type;
      content += `- \`${arg}\` (${typeStr})`;
      if (attr.description) {
        const desc = attr.description.length > 50 
          ? attr.description.substring(0, 50) + '...' 
          : attr.description;
        content += ` - ${desc}`;
      }
      content += '\n';
    });
    
    if (docs.optional_args.length > 2) {
      content += `- ... and ${docs.optional_args.length - 2} more optional args\n`;
    }
  }

  // Add required blocks
  if (docs.required_blocks && docs.required_blocks.length > 0) {
    content += `\n**Required Blocks:**\n`;
    docs.required_blocks.forEach(blockName => {
      const block = docs.blocks![blockName];
      content += `- \`${blockName}\` block`;
      if (block.description) {
        const desc = block.description.length > 50 
          ? block.description.substring(0, 50) + '...' 
          : block.description;
        content += ` - ${desc}`;
      }
      content += '\n';
      
      // Show block attributes in a code block
      if (block.block && block.block.attributes) {
        const blockAttrs = Object.entries(block.block.attributes)
          .filter(([name]) => name !== 'arguments'); // Filter out 'arguments' attribute
        if (blockAttrs.length > 0) {
          content += '```hcl\n';
          content += `${blockName} {\n`;
          blockAttrs.slice(0, 4).forEach(([name, attr]) => {
            const typedAttr = attr as TerraformAttribute;
            const typeStr = Array.isArray(typedAttr.type) ? typedAttr.type.join('|') : typedAttr.type;
            const requiredMarker = typedAttr.required ? ' # required' : ' # optional';
            content += `  ${name} = ${typeStr}${requiredMarker}\n`;
          });
          if (blockAttrs.length > 4) {
            content += `  # ... and ${blockAttrs.length - 4} more attributes\n`;
          }
          content += '}\n';
          content += '```\n';
        }
      }
    });
  }

  // Add optional blocks
  if (docs.optional_blocks && docs.optional_blocks.length > 0) {
    content += `\n**Optional Blocks:**\n`;
    docs.optional_blocks.slice(0, 2).forEach(blockName => {
      const block = docs.blocks![blockName];
      content += `- \`${blockName}\` block`;
      if (block.description) {
        const desc = block.description.length > 50 
          ? block.description.substring(0, 50) + '...' 
          : block.description;
        content += ` - ${desc}`;
      }
      content += '\n';
      
      // Show block attributes in a code block
      if (block.block && block.block.attributes) {
        const blockAttrs = Object.entries(block.block.attributes)
          .filter(([name]) => name !== 'arguments'); // Filter out 'arguments' attribute
        if (blockAttrs.length > 0) {
          content += '```hcl\n';
          content += `${blockName} {\n`;
          blockAttrs.slice(0, 4).forEach(([name, attr]) => {
            const typedAttr = attr as TerraformAttribute;
            const typeStr = Array.isArray(typedAttr.type) ? typedAttr.type.join('|') : typedAttr.type;
            const requiredMarker = typedAttr.required ? ' # required' : ' # optional';
            content += `  ${name} = ${typeStr}${requiredMarker}\n`;
          });
          if (blockAttrs.length > 4) {
            content += `  # ... and ${blockAttrs.length - 4} more attributes\n`;
          }
          content += '}\n';
          content += '```\n';
        }
      }
    });
    
    if (docs.optional_blocks.length > 2) {
      content += `- ... and ${docs.optional_blocks.length - 2} more optional blocks\n`;
    }
  }

  return content;
}

/**
 * Loads cached documentation from disk
 * @param workingDirectory The terraform working directory
 * @param resourceType The resource type ("resource" or "data")
 * @param resourceName The resource name
 * @returns Promise<TerraformDocumentation | null>
 */
async function loadCachedDocumentation(
  workingDirectory: string,
  resourceType: string,
  resourceName: string
): Promise<TerraformDocumentation | null> {
  try {
    // We'll need to parse the lock file to get provider version
    const providerInfo = await getProviderInfo(workingDirectory, resourceName);
    if (!providerInfo) {
      return null;
    }

    const cacheDir = path.join(workingDirectory, '.terraform', 'docs', `${providerInfo.name}-v${providerInfo.version}`);
    const cacheFile = path.join(cacheDir, `${resourceName}.json`);
    
    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const content = fs.readFileSync(cacheFile, 'utf8');
    return JSON.parse(content) as TerraformDocumentation;
  } catch (error) {
    console.debug('Error loading cached documentation:', error);
    return null;
  }
}

/**
 * Loads cached formatted documentation from disk
 * @param workingDirectory The terraform working directory
 * @param resourceType The resource type ("resource" or "data")
 * @param resourceName The resource name
 * @returns Promise<string | null>
 */
export async function loadCachedFormattedDocumentation(
  workingDirectory: string,
  resourceType: string,
  resourceName: string
): Promise<string | null> {
  try {
    // We'll need to parse the lock file to get provider version
    const providerInfo = await getProviderInfo(workingDirectory, resourceName);
    if (!providerInfo) {
      return null;
    }

    const cacheDir = path.join(workingDirectory, '.terraform', 'docs', `${providerInfo.name}-v${providerInfo.version}`);
    const markdownFile = path.join(cacheDir, `${resourceName}.readme`);
    
    if (!fs.existsSync(markdownFile)) {
      return null;
    }

    const content = fs.readFileSync(markdownFile, 'utf8');
    console.debug('Using cached formatted documentation for', resourceName);
    return content;
  } catch (error) {
    console.debug('Error loading cached formatted documentation:', error);
    return null;
  }
}

/**
 * Saves documentation to disk cache
 * @param workingDirectory The terraform working directory
 * @param resourceType The resource type ("resource" or "data")
 * @param resourceName The resource name
 * @param docs The documentation object
 * @param providerKey The provider key from schema
 */
async function saveCachedDocumentation(
  workingDirectory: string,
  resourceType: string,
  resourceName: string,
  docs: TerraformDocumentation,
  providerKey: string
): Promise<void> {
  try {
    // Parse provider name and version from provider key or lock file
    const providerInfo = await getProviderInfo(workingDirectory, resourceName);
    if (!providerInfo) {
      console.debug('Could not determine provider info, skipping cache');
      return;
    }

    const cacheDir = path.join(workingDirectory, '.terraform', 'docs', `${providerInfo.name}-v${providerInfo.version}`);
    
    // Create cache directory if it doesn't exist
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, `${resourceName}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(docs, null, 2));

    // Also save the formatted markdown
    const markdownFile = path.join(cacheDir, `${resourceName}.readme`);
    const markdownContent = formatDocumentationForHover(docs, resourceName);
    fs.writeFileSync(markdownFile, markdownContent);

    console.debug(`Cached documentation for ${resourceName} to ${cacheFile}`);
  } catch (error) {
    console.debug('Error saving cached documentation:', error);
  }
}

/**
 * Gets provider name and version for a resource from the lock file
 * @param workingDirectory The terraform working directory
 * @param resourceName The resource name
 * @returns Promise<{name: string, version: string} | null>
 */
async function getProviderInfo(
  workingDirectory: string,
  resourceName: string
): Promise<{name: string, version: string} | null> {
  try {
    const lockFilePath = path.join(workingDirectory, '.terraform.lock.hcl');
    if (!fs.existsSync(lockFilePath)) {
      return null;
    }

    const lockContent = fs.readFileSync(lockFilePath, 'utf8');
    
    // Try to extract provider info from resource name
    // For example, "rabbitmq_exchange" -> provider could be "rabbitmq"
    const providerPrefix = resourceName.split('_')[0];
    
    // Look for provider block in lock file
    const providerRegex = new RegExp(`provider\\s+"([^"]*${providerPrefix}[^"]*)"\\s*{[^}]*version\\s*=\\s*"([^"]+)"`, 'i');
    const match = lockContent.match(providerRegex);
    
    if (match) {
      const fullProviderName = match[1];
      const version = match[2];
      // Extract just the provider name (e.g., "registry.terraform.io/hashicorp/aws" -> "aws")
      const providerName = fullProviderName.split('/').pop() || providerPrefix;
      return { name: providerName, version };
    }

    // Fallback: try to find any provider with matching prefix
    const lines = lockContent.split('\n');
    let currentProvider = '';
    let currentVersion = '';
    
    for (const line of lines) {
      const providerMatch = line.match(/provider\s+"([^"]+)"/);
      if (providerMatch) {
        currentProvider = providerMatch[1];
      }
      
      const versionMatch = line.match(/version\s*=\s*"([^"]+)"/);
      if (versionMatch && currentProvider.includes(providerPrefix)) {
        currentVersion = versionMatch[1];
        const providerName = currentProvider.split('/').pop() || providerPrefix;
        return { name: providerName, version: currentVersion };
      }
    }

    return null;
  } catch (error) {
    console.debug('Error parsing provider info:', error);
    return null;
  }
}

/**
 * Clears the schema cache
 */
export function clearDocumentationCache(): void {
  schemaCache.clear();
}

/**
 * Clears disk cache for a specific directory
 * @param workingDirectory The terraform working directory
 */
export function clearDiskCache(workingDirectory: string): void {
  try {
    const cacheDir = path.join(workingDirectory, '.terraform', 'docs');
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.debug('Cleared disk cache for', workingDirectory);
    }
  } catch (error) {
    console.debug('Error clearing disk cache:', error);
  }
}

/**
 * Gets the current cache size
 */
export function getCacheSize(): number {
  return schemaCache.size;
}
