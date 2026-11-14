/** 1 so'm = 100 tiyin. All amounts in the database are tiyin. */
export const somToTiyin = (som: number): number => Math.round(som * 100);
export const tiyinToSom = (tiyin: number): number => tiyin / 100;

/** "125 000 so'm" */
export function formatSom(tiyin: number): string {
  const som = Math.floor(tiyin / 100);
  return `${som.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} so'm`;
}

/** Commission in tiyin for an amount, given basis points (1000 = 10%). Rounded half up. */
export function commissionFor(amount: number, bps: number): number {
  return Math.floor((amount * bps + 5000) / 10000);
}
