/** Amounts come from the API in tiyin. */
export const som = (tiyin: number) => `${Math.floor(tiyin / 100).toLocaleString("ru-RU").replace(/ /g, " ")} so'm`;
export const somShort = (tiyin: number) => {
  const s = tiyin / 100;
  if (s >= 1_000_000) return `${(s / 1_000_000).toFixed(s >= 10_000_000 ? 0 : 1).replace(".", ",")} mln`;
  if (s >= 1_000) return `${Math.round(s / 1_000)} ming`;
  return String(s);
};
export const date = (iso: string | Date) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};
export const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
export const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"];
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
export const durationLabel = (days: number) =>
  days % 365 === 0 ? `${days / 365 * 12} oy` : days % 30 === 0 ? `${days / 30} oy` : `${days} kun`;
