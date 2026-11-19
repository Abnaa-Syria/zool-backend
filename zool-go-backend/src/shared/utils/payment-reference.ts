/** Trim, uppercase, keep alphanumerics only. Empty → null. */
export function normalizePaymentReference(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length > 0 ? normalized : null;
}
