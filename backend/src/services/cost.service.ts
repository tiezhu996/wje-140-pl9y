import { Injectable } from '@nestjs/common';
import { TransactionalParticipant } from '../utils/transaction';

export interface CostSummaryRow {
  id: number;
  vehicleId: number;
  month: string;
  fuelTotal: number;
  maintenanceTotal: number;
  tollTotal: number;
  laborTotal: number;
  fixedCost: number;
  totalCost: number;
  totalRevenue: number;
  profit: number;
}

export interface TripSettlementInput {
  vehicleId: number;
  month: string;
  freight: number;
  fuelCost: number;
  tollCost: number;
  laborCost: number;
  dailyFixedCost: number;
  tripDays: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class CostService implements TransactionalParticipant {
  private rows: CostSummaryRow[] = [
    {
      id: 1,
      vehicleId: 1,
      month: '2026-06',
      fuelTotal: 1776,
      maintenanceTotal: 2100,
      tollTotal: 420,
      laborTotal: 2500,
      fixedCost: 7800,
      totalCost: 14596,
      totalRevenue: 22600,
      profit: 8004
    }
  ];

  findAll(): CostSummaryRow[] {
    return this.rows;
  }

  findOne(id: number): CostSummaryRow | undefined {
    return this.rows.find((item) => item.id === id);
  }

  create(payload: Partial<CostSummaryRow>): CostSummaryRow {
    const id = this.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    const row: CostSummaryRow = {
      id,
      vehicleId: payload.vehicleId ?? 0,
      month: payload.month ?? '',
      fuelTotal: payload.fuelTotal ?? 0,
      maintenanceTotal: payload.maintenanceTotal ?? 0,
      tollTotal: payload.tollTotal ?? 0,
      laborTotal: payload.laborTotal ?? 0,
      fixedCost: payload.fixedCost ?? 0,
      totalCost: payload.totalCost ?? 0,
      totalRevenue: payload.totalRevenue ?? 0,
      profit: payload.profit ?? 0
    };
    this.rows.push(row);
    return row;
  }

  /** 事务参与方：快照全部费用汇总行 */
  snapshot(): unknown {
    return this.rows.map((row) => ({ ...row }));
  }

  /** 事务参与方：回滚时整体恢复（含删除本次结算新增的汇总行） */
  restore(checkpoint: unknown): void {
    this.rows = (checkpoint as CostSummaryRow[]).map((row) => ({ ...row }));
  }

  /**
   * 完成结算时按「车辆 + 统计月份」汇总：累加本次实际油费、路费、人工、
   * 运费收入及行程占用的固定成本，并重算总成本与利润。
   * 同一事务内由 DispatchService 登记后调用，失败随事务整体回滚。
   */
  settleTrip(input: TripSettlementInput): CostSummaryRow {
    let summary = this.rows.find((row) => row.vehicleId === input.vehicleId && row.month === input.month);
    if (!summary) {
      summary = this.create({
        vehicleId: input.vehicleId,
        month: input.month,
        fuelTotal: 0,
        maintenanceTotal: 0,
        tollTotal: 0,
        laborTotal: 0,
        fixedCost: 0,
        totalCost: 0,
        totalRevenue: 0,
        profit: 0
      });
    }
    summary.fuelTotal = round2(summary.fuelTotal + input.fuelCost);
    summary.tollTotal = round2(summary.tollTotal + input.tollCost);
    summary.laborTotal = round2(summary.laborTotal + input.laborCost);
    summary.fixedCost = round2(summary.fixedCost + input.dailyFixedCost * input.tripDays);
    summary.totalRevenue = round2(summary.totalRevenue + input.freight);
    summary.totalCost = round2(
      summary.fuelTotal + summary.maintenanceTotal + summary.tollTotal + summary.laborTotal + summary.fixedCost
    );
    summary.profit = round2(summary.totalRevenue - summary.totalCost);
    return summary;
  }
}
