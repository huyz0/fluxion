const fmt = new Intl.DateTimeFormat('en');
export const now = (): string => fmt.format();
