export function displayCode(value) {
  if (value == null || value === '') return 'Unavailable';
  return String(value).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}
