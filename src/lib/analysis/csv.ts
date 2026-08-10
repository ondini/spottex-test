export function csvCell(value: unknown) {
  if (value == null) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: unknown[]) {
  return values.map(csvCell).join(";");
}
