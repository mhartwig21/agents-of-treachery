/**
 * Minimal YAML-like parser for secrets vault.
 *
 * Supports simple key-value pairs and nested objects.
 * Uses JSON internally for reliable parsing.
 */

/**
 * Parse YAML-like content to object.
 */
export function parse(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) {
    return {};
  }

  // If it looks like JSON, parse as JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  // Simple key: value parsing
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    let value = trimmedLine.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Stringify object to YAML-like content.
 */
export function stringify(data: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (value.includes(':') || value.includes('#') || value.includes('\n')) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (value === null || value === undefined) {
      lines.push(`${key}: null`);
    } else {
      // For complex objects, use JSON
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  return lines.join('\n');
}
