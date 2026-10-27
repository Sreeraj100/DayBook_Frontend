export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftDate(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year!, month! - 1, day! + amount, 12);
  return localDate(date);
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year!, month! - 1, day!, 12));
}
