export function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  if (start < 0) {
    throw new Error('No JSON object found in Gemini response');
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  throw new Error('JSON object was not balanced');
}

export function parseGeminiJsonPayload<T>(stdout: string): T {
  const outer = JSON.parse(stdout) as { response?: string; error?: unknown };
  if (outer.error) {
    throw new Error(`Gemini returned an error payload: ${JSON.stringify(outer.error)}`);
  }
  if (typeof outer.response !== 'string') {
    throw new Error('Gemini JSON output did not include a response field');
  }
  return JSON.parse(extractJsonObject(outer.response)) as T;
}
