export const later = (f: () => void): unknown => setTimeout(f, 1);
