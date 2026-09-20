import { Injectable } from '@nestjs/common';
import { calculateProfit, calculateTotalCost } from '../utils/costCalculator';

export interface TripSettlementDelta {
  fuel: number;
  toll: number;
  labor: number;
  revenue: number;
}

@Injectable()
export class CostService {
  private rows: any[] = [{ id: 1, vehicleId: 1, month: '2026-06', fuelTotal: 1776, maintenanceTotal: 2100, tollTotal: 420, laborTotal: 2500, fixedCost: 7800, totalCost: 14596, totalRevenue: 22600, profit: 8004 }];
  findAll() { return this.rows; }
  findOne(id: number) { return this.rows.find((item: any) => item.id === id); }
  create(payload: any) { const row = { ...payload, id: this.rows.length + 1 }; this.rows.push(row); return row; }

  findMonthlySummary(vehicleId: number, month: string) {
    return this.rows.find((item: any) => item.vehicleId === vehicleId && item.month === month);
  }

  applyTripSettlement(vehicleId: number, month: string, delta: TripSettlementDelta) {
    let row: any = this.findMonthlySummary(vehicleId, month);
    if (!row) {
      row = { id: this.rows.length + 1, vehicleId, month, fuelTotal: 0, maintenanceTotal: 0, tollTotal: 0, laborTotal: 0, fixedCost: 0, totalCost: 0, totalRevenue: 0, profit: 0 };
      this.rows.push(row);
    }
    row.fuelTotal += delta.fuel;
    row.tollTotal += delta.toll;
    row.laborTotal += delta.labor;
    row.totalRevenue += delta.revenue;
    row.totalCost = calculateTotalCost(row.fuelTotal, row.maintenanceTotal, row.tollTotal, row.laborTotal, row.fixedCost);
    row.profit = calculateProfit(row.totalRevenue, row.totalCost, 0, 0);
    return row;
  }

  restoreMonthlySummary(snapshot: any, vehicleId: number, month: string) {
    const row: any = this.findMonthlySummary(vehicleId, month);
    if (snapshot === null) {
      if (row) this.rows.splice(this.rows.indexOf(row), 1);
      return;
    }
    if (row) Object.assign(row, snapshot);
    else this.rows.push({ ...snapshot });
  }
}
