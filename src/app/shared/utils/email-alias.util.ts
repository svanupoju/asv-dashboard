export function normalizeAppEmail(email: string | null | undefined): string | null {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized === 'saivamsi715@gmail.com'
    ? 'saivamsi.anupoju@gmail.com'
    : normalized;
}