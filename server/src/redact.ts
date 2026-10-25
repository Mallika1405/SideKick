// Nothing leaves the machine without passing through here.
const IGNORE_FILE = [/(^|\/)\.env(\..*)?$/, /\.pem$/, /\.key$/, /(^|\/)id_rsa/];
const SECRET_PATTERNS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
  [/sk_car_[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]'],
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]'],
  [/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'Bearer [REDACTED]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
];
export const isIgnored = (path: string) => IGNORE_FILE.some((r) => r.test(path));
export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);
}
