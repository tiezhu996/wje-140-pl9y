import { VehicleType } from '../types/enums';

/**
 * 完成结算时的计价规则（按实际里程重算，不使用派单时的预估金额）。
 * 油耗单价按车型给出：元/公里；路费单价：元/公里。
 */
export const FUEL_RATE_BY_VEHICLE: Record<string, number> = {
  [VehicleType.LightTruck]: 0.9,
  [VehicleType.MediumTruck]: 1.25,
  [VehicleType.HeavyTruck]: 1.85,
  [VehicleType.Refrigerated]: 1.65,
  [VehicleType.Hazmat]: 1.95
};
export const TOLL_RATE_BY_VEHICLE: Record<string, number> = {
  [VehicleType.LightTruck]: 0.45,
  [VehicleType.MediumTruck]: 0.6,
  [VehicleType.HeavyTruck]: 0.9,
  [VehicleType.Refrigerated]: 0.75,
  [VehicleType.Hazmat]: 0.95
};
/** 冷链货物关键字，出现在货物描述中即视为需要冷藏车 */
export const COLD_CHAIN_KEYWORD = '冷链';

export interface SettlementInput {
  actualMileage: number;
  vehicleType: string;
  freight: number;
  monthlySalary: number;
  /** 行程占用天数，用于折算人工成本，不足 1 天按 1 天计 */
  tripDays: number;
}

export interface SettlementResult {
  actualFuelCost: number;
  actualTollCost: number;
  laborCost: number;
  profit: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 货物是否需要冷链运输 */
export function isColdChainCargo(cargo: string): boolean {
  return typeof cargo === 'string' && cargo.includes(COLD_CHAIN_KEYWORD);
}

/** 冷链货物必须匹配冷藏车，普通货物不限制车型 */
export function isCargoVehicleCompatible(cargo: string, vehicleType: string): boolean {
  if (!isColdChainCargo(cargo)) {
    return true;
  }
  return vehicleType === VehicleType.Refrigerated;
}

/** 计算实际行驶里程，里程倒挂（小于出发里程或为负）返回 null 由调用方报冲突 */
export function resolveActualMileage(startMileage: number, endMileage: number): number | null {
  if (!Number.isFinite(endMileage) || endMileage < 0) {
    return null;
  }
  const mileage = endMileage - startMileage;
  return mileage < 0 ? null : mileage;
}

/** 按实际出发/到达时间折算行程天数，至少 1 天 */
export function resolveTripDays(actualDepartAt: string, actualArriveAt: string): number {
  const departMs = new Date(actualDepartAt).getTime();
  const arriveMs = new Date(actualArriveAt).getTime();
  if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs) || arriveMs < departMs) {
    return 1;
  }
  return Math.max(1, Math.ceil((arriveMs - departMs) / (24 * 60 * 60 * 1000)));
}

/**
 * 按实际里程重算四类金额：实际油费、实际路费、人工、利润。
 * 利润 = 运费 - 实际油费 - 实际路费 - 人工。
 */
export function recalculateSettlement(input: SettlementInput): SettlementResult {
  const fuelRate = FUEL_RATE_BY_VEHICLE[input.vehicleType] ?? 1.2;
  const tollRate = TOLL_RATE_BY_VEHICLE[input.vehicleType] ?? 0.6;
  const actualFuelCost = round2(input.actualMileage * fuelRate);
  const actualTollCost = round2(input.actualMileage * tollRate);
  const laborCost = round2((input.monthlySalary / 30) * Math.max(1, input.tripDays));
  const profit = round2(input.freight - actualFuelCost - actualTollCost - laborCost);
  return { actualFuelCost, actualTollCost, laborCost, profit };
}
