/**
 * Text formatting utilities for converting ANSI codes to VS Code-compatible output
 */

/**
 * Strips all ANSI escape codes from text
 */
export function stripAnsiCodes(text: string): string {
  // Remove ANSI escape codes
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Converts ANSI color codes to VS Code-compatible text with semantic prefixes
 */
export function convertAnsiToVSCode(text: string): string {
  if (!text) return text;

  // First, let's identify meaningful content vs box drawing
  const hasBoxChars = /[│╷╵┌┐└┘]/.test(text);
  const hasErrorKeyword = /Error:/i.test(text);
  const hasWarningKeyword = /Warning:/i.test(text);
  const hasSuccessKeyword = /(success|completed|initialized)/i.test(text);

  // Convert ANSI codes but be smart about prefixes
  let converted = text
    // Remove bold/reset codes first
    .replace(/\x1b\[1m/g, '')
    .replace(/\x1b\[0m/g, '')

    // Handle red text (errors) - only add prefix if it's meaningful content
    .replace(/\x1b\[31m/g, hasBoxChars ? '' : hasErrorKeyword ? '' : '[ERROR] ')
    .replace(
      /\x1b\[0;31m/g,
      hasBoxChars ? '' : hasErrorKeyword ? '' : '[ERROR] '
    )
    .replace(
      /\x1b\[1;31m/g,
      hasBoxChars ? '' : hasErrorKeyword ? '' : '[ERROR] '
    )

    // Handle green text (success)
    .replace(/\x1b\[32m/g, hasSuccessKeyword ? '' : '[SUCCESS] ')
    .replace(/\x1b\[0;32m/g, hasSuccessKeyword ? '' : '[SUCCESS] ')
    .replace(/\x1b\[1;32m/g, hasSuccessKeyword ? '' : '[SUCCESS] ')

    // Handle yellow text (warnings)
    .replace(/\x1b\[33m/g, hasWarningKeyword ? '' : '[WARNING] ')
    .replace(/\x1b\[0;33m/g, hasWarningKeyword ? '' : '[WARNING] ')
    .replace(/\x1b\[1;33m/g, hasWarningKeyword ? '' : '[WARNING] ')

    // Handle blue text (info) - be conservative
    .replace(/\x1b\[34m/g, '')
    .replace(/\x1b\[0;34m/g, '')
    .replace(/\x1b\[1;34m/g, '')

    // Clean up any remaining ANSI codes
    .replace(/\x1b\[[0-9;]*m/g, '');

  // Clean up extra spaces and handle special cases
  converted = converted.replace(/\s+/g, ' ').trim();

  // If this line only contains box drawing characters, skip it or simplify it
  if (/^[│╷╵\s]*$/.test(converted)) {
    return '';
  }

  // Add ERROR prefix only to lines that have actual error content
  if (hasErrorKeyword && !converted.startsWith('[ERROR]')) {
    converted = '[ERROR] ' + converted;
  }

  return converted;
}
