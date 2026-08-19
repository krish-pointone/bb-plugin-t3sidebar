export const FOLDER_COLOR_PRESETS = [
  { label: "Blue", color: "#3b82f6" },
  { label: "Violet", color: "#8b5cf6" },
  { label: "Pink", color: "#ec4899" },
  { label: "Orange", color: "#f97316" },
  { label: "Emerald", color: "#10b981" },
  { label: "Cyan", color: "#06b6d4" },
] as const;

export const DEFAULT_FOLDER_COLORS = FOLDER_COLOR_PRESETS.map(
  (preset) => preset.color,
);

export type FolderColor = string;

const LEGACY_COLORS: Readonly<Record<string, FolderColor>> = {
  blue: "#3b82f6",
  violet: "#8b5cf6",
  pink: "#ec4899",
  orange: "#f97316",
  emerald: "#10b981",
  cyan: "#06b6d4",
};

export function isFolderColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeFolderColor(value: string): FolderColor {
  return (LEGACY_COLORS[value] ?? (isFolderColor(value) ? value : DEFAULT_FOLDER_COLORS[0])).toLowerCase();
}

export function folderColorWithAlpha(color: FolderColor, alpha: string): string {
  return `${normalizeFolderColor(color)}${alpha}`;
}
