// Gateways can return plain text/HTML on timeouts, even for a JSON API route.
export async function readApplicationJson(response: Response) {
  try {
    const value = JSON.parse(await response.text());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Do not show proxy responses or JSON parser internals to applicants. */ }
  throw new Error([408, 504, 524].includes(response.status)
    ? 'The request timed out. Your saved progress is kept. Try again to resume.'
    : 'The server could not complete this request. Your saved progress is kept. Please retry.');
}
