// Keep development usable; production must never sign with a public fallback.
export function sessionSecret(name = "SESSION_SECRET") {
  const value = process.env[name];
  if (value && value.length >= 32 && !value.includes("dev-secret-please-rotate") && !/^(replace-|change-me|your-)/i.test(value)) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} must be configured with at least 32 random characters.`);
  return value || `fetch-it-local-only-${name}-development-secret`;
}
