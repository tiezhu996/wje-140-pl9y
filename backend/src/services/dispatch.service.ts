import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DispatchStatus, VehicleType } from '../types/enums';
import { CompleteTripPayload, SettlementBreakdown } from '../types/interfaces';
import { calculateProfit, calculateTripDays, calculateTripFuelCost, calculateTripLaborCost, calculateTripTollCost } from '../utils/costCalculator';
import { generateOrderNo } from '../utils/orderNumber';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { CostService } from './cost.service';

const COLD_CHAIN_KEYWORD = '冷链';

@Injectable()
export class DispatchService {
  private rows: any[] = [{ id: 1, orderNo: 'DSP-20260612-0001', vehicleId: 1, driverId: 1, origin: '上海青浦仓', destination: '杭州萧山仓', planDepartAt: '2026-06-12 09:00', planArriveAt: '2026-06-12 13:30', actualDepartAt: null, actualArriveAt: null, cargo: '冷链食品', weight: 8200, volume: 42, freight: 7200, estimatedFuelCost: 1500, estimatedTollCost: 420, status: 'Draft', tripDistance: null, actualFuelCost: null, actualTollCost: null, laborCost: null, profit: 4180 }];

  constructor(
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly costs: CostService,
  ) {}

  findAll() { return this.rows; }

  findOne(id: number) {
    const row = this.mustFind(id);
    return {
      ...row,
      settlement: row.status === DispatchStatus.Completed
        ? { tripDistance: row.tripDistance, fuelCost: row.actualFuelCost, tollCost: row.actualTollCost, laborCost: row.laborCost, profit: row.profit }
        : null,
    };
  }

  create(payload: any) {
    const row = { orderNo: generateOrderNo(), status: DispatchStatus.Draft, actualDepartAt: null, actualArriveAt: null, tripDistance: null, actualFuelCost: null, actualTollCost: null, laborCost: null, profit: 0, ...payload, id: this.rows.length + 1 };
    this.rows.push(row);
    return row;
  }

  assign(id: number) {
    const order = this.mustFind(id);
    if (order.status !== DispatchStatus.Draft) throw new ConflictException(`调度单当前状态为 ${order.status}，仅草稿单可派单`);
    const vehicle = this.vehicles.findOne(order.vehicleId);
    if (!vehicle) throw new NotFoundException(`车辆 ${order.vehicleId} 不存在`);
    const driver = this.drivers.findOne(order.driverId);
    if (!driver) throw new NotFoundException(`司机 ${order.driverId} 不存在`);
    if (!this.vehicles.isIdle(order.vehicleId)) throw new ConflictException(`车辆 ${vehicle.plateNo} 非空闲，无法派单`);
    if (!this.drivers.isIdle(order.driverId)) throw new ConflictException(`司机 ${driver.name} 非空闲，无法派单`);
    if (this.isColdChain(order.cargo) && vehicle.vehicleType !== VehicleType.Refrigerated) {
      throw new BadRequestException('冷链货物必须匹配冷藏车（Refrigerated）');
    }
    if (!this.vehicles.lockForOrder(order.vehicleId, order.id)) throw new ConflictException('车辆被并发抢占，派单失败');
    if (!this.drivers.lockForOrder(order.driverId, order.id)) {
      this.vehicles.releaseFromOrder(order.vehicleId, order.id);
      throw new ConflictException('司机被并发抢占，派单失败');
    }
    order.status = DispatchStatus.Assigned;
    return order;
  }

  start(id: number) {
    const order = this.mustFind(id);
    if (order.status !== DispatchStatus.Assigned) throw new ConflictException(`调度单当前状态为 ${order.status}，仅已派单可发车`);
    order.status = DispatchStatus.InProgress;
    order.actualDepartAt = this.now();
    return order;
  }

  complete(id: number, payload: CompleteTripPayload) {
    const order = this.mustFind(id);
    if (order.status === DispatchStatus.Completed) throw new ConflictException('调度单已完成，禁止重复结算');
    if (order.status !== DispatchStatus.InProgress) throw new ConflictException(`调度单当前状态为 ${order.status}，仅在途单可完成`);
    const endMileage = Number(payload?.endMileage);
    if (!Number.isFinite(endMileage)) throw new BadRequestException('endMileage 必须为数字');
    const vehicle = this.vehicles.findOne(order.vehicleId);
    const driver = this.drivers.findOne(order.driverId);
    if (!vehicle || vehicle.lockedByOrderId !== order.id) throw new ConflictException('车辆已被其他调度单抢占，结算冲突');
    if (!driver || driver.lockedByOrderId !== order.id) throw new ConflictException('司机已被其他调度单抢占，结算冲突');
    if (endMileage < vehicle.mileage) throw new ConflictException(`里程倒挂：结束里程 ${endMileage} 小于车辆当前里程 ${vehicle.mileage}`);

    const actualArriveAt = payload.actualArriveAt || this.now();
    const settlement = this.buildSettlement(order, vehicle, driver, endMileage, actualArriveAt);
    const month = actualArriveAt.slice(0, 7);
    const snapshot = {
      order: { ...order },
      vehicle: { ...vehicle },
      driver: { ...driver },
      summary: this.costs.findMonthlySummary(vehicle.id, month) ? { ...this.costs.findMonthlySummary(vehicle.id, month) } : null,
    };
    try {
      this.costs.applyTripSettlement(vehicle.id, month, { fuel: settlement.fuelCost, toll: settlement.tollCost, labor: settlement.laborCost, revenue: order.freight });
      if (!this.vehicles.advanceMileage(vehicle.id, endMileage)) throw new ConflictException('车辆里程推进失败，结算回滚');
      if (!this.vehicles.releaseFromOrder(vehicle.id, order.id)) throw new ConflictException('车辆释放失败，结算回滚');
      if (!this.drivers.releaseFromOrder(driver.id, order.id)) throw new ConflictException('司机释放失败，结算回滚');
      Object.assign(order, {
        status: DispatchStatus.Completed,
        actualArriveAt,
        tripDistance: settlement.tripDistance,
        actualFuelCost: settlement.fuelCost,
        actualTollCost: settlement.tollCost,
        laborCost: settlement.laborCost,
        profit: settlement.profit,
      });
    } catch (err) {
      Object.assign(order, snapshot.order);
      Object.assign(vehicle, snapshot.vehicle);
      Object.assign(driver, snapshot.driver);
      this.costs.restoreMonthlySummary(snapshot.summary, vehicle.id, month);
      throw err;
    }
    return this.findOne(id);
  }

  cancel(id: number) {
    const order = this.mustFind(id);
    if (order.status === DispatchStatus.Completed) throw new ConflictException('调度单已结算，不能取消');
    if (order.status === DispatchStatus.Cancelled) throw new ConflictException('调度单已取消，请勿重复操作');
    this.vehicles.releaseFromOrder(order.vehicleId, order.id);
    this.drivers.releaseFromOrder(order.driverId, order.id);
    order.status = DispatchStatus.Cancelled;
    return order;
  }

  private buildSettlement(order: any, vehicle: any, driver: any, endMileage: number, actualArriveAt: string): SettlementBreakdown {
    const tripDistance = Math.round((endMileage - vehicle.mileage) * 100) / 100;
    const fuelCost = calculateTripFuelCost(tripDistance);
    const tollCost = calculateTripTollCost(tripDistance);
    const laborCost = calculateTripLaborCost(calculateTripDays(order.actualDepartAt || order.planDepartAt, actualArriveAt), driver.monthlySalary);
    return { tripDistance, fuelCost, tollCost, laborCost, profit: calculateProfit(order.freight, fuelCost, tollCost, laborCost) };
  }

  private isColdChain(cargo: string) {
    return typeof cargo === 'string' && cargo.includes(COLD_CHAIN_KEYWORD);
  }

  private mustFind(id: number) {
    const row = this.rows.find((item: any) => item.id === id);
    if (!row) throw new NotFoundException(`调度单 ${id} 不存在`);
    return row;
  }

  private now() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
}
