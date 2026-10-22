export interface TariffPeriod {
  effective_from: string;
  effective_to: string | null;
  source_reference?: string | null;
  approved_by?: string | null;
}

export function selectActiveTariff<T extends TariffPeriod>(
  tariffs: readonly T[],
  date: string,
): T | null {
  return tariffs
    .filter(
      (tariff) =>
        tariff.effective_from <= date &&
        (!tariff.effective_to || tariff.effective_to > date),
    )
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}

export function isOfficialTariff(tariff: TariffPeriod): boolean {
  return Boolean(tariff.source_reference?.trim() && tariff.approved_by?.trim());
}

export function tariffLabel(tariff: TariffPeriod): 'Official tariff' | 'Tariff pending approval' {
  return isOfficialTariff(tariff) ? 'Official tariff' : 'Tariff pending approval';
}