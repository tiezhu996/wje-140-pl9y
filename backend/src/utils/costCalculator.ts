export const FUEL_COST_PER_KM = 7.5;
export const TOLL_COST_PER_KM = 2.1;
export const WORK_DAYS_PER_MONTH = 30;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateTripFuelCost(distanceKm: number) {
  return round2(distanceKm * FUEL_COST_PER_KM);
}

export function calculateTripTollCost(distanceKm: number) {
  return round2(distanceKm * TOLL_COST_PER_KM);
}

export function calculateTripLaborCost(tripDays: number, monthlySalary: number) {
  const days = Math.max(1, tripDays);
  return round2((monthlySalary / WORK_DAYS_PER_MONTH) * days);
}

export function calculateTripDays(departAt: string, arriveAt: string) {
  const millis = new Date(arriveAt).getTime() - new Date(departAt).getTime();
  if (!Number.isFinite(millis) || millis <= 0) return 1;
  return Math.max(1, Math.ceil(millis / (24 * 3600 * 1000)));
}

export function calculateProfit(freight: number, fuelCost: number, tollCost: number, laborCost: number) {
  return round2(freight - fuelCost - tollCost - laborCost);
}

export function calculateTotalCost(...items: number[]) {
  return round2(items.reduce((sum, item) => sum + item, 0));
}
