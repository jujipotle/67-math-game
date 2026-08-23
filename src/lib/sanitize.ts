/** Shared player/room name rules: 1–20 chars, letters/digits/space/_/-. */
export function sanitizeName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > 20) return null;
  if (!/^[a-zA-Z0-9 _-]+$/.test(name)) return null;
  return name;
}
