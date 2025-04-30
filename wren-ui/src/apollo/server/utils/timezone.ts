export function getUTCOffsetMinutes(timeZone: string) {
  const date = new Date();
  const utcDate = new Date(
    date.toLocaleString('en-US', { timeZone: 'UTC' }),
  ) as any;
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone })) as any;

  return (tzDate - utcDate) / 60000; // Convert to minutes
}

export function formatUTCOffset(offsetMinutes: number) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absOffset / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (absOffset % 60).toString().padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}
