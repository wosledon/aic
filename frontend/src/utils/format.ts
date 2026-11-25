import dayjs from 'dayjs';

export const numberFormat = new Intl.NumberFormat('zh-CN');
export const compactFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return numberFormat.format(value);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return compactFormat.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value.toFixed(digits)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD');
}

export function fromNow(value: string | null | undefined): string {
  if (!value) return '-';
  const then = dayjs(value);
  const diff = dayjs().diff(then, 'minute');
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${diff} 分钟前`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)} 小时前`;
  return `${Math.floor(diff / 60 / 24)} 天前`;
}

export function isoDaysAgo(days: number): string {
  return dayjs().subtract(days, 'day').startOf('day').toISOString();
}

export function isoNow(): string {
  return dayjs().toISOString();
}

export function isoDate(value: dayjs.Dayjs | null): string | undefined {
  return value ? value.toISOString() : undefined;
}