import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { DispatchStatus } from '../types/enums';
import {
  AssignOrderPayload,
  CompleteOrderPayload,
  OrderSettlement,
  StartOrderPayload
} from '../types/interfaces';
import { InMemoryTransaction, TransactionalParticipant } from '../utils/transaction';
import {
  isCargoVehicleCompatible,
  isColdChainCargo,
  recalculateSettlement,
  resolveActualMileage,
  resolveTripDays
} from '../utils/settlementCalculator';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { CostService } from './cost.service';

export interface DispatchOrderRow {
  id: number;
  orderNo: string;
  vehicleId: number | null;
  driverId: number | null;
  origin: string;
  destination: string;
  planDepartAt: string;
  planArriveAt: string;
  actualDepartAt: string | null;
  actualArriveAt: string | null;
  cargo: string;
  weight: number;
  volume: number;
  freight: number;
  estimatedFuelCost: number;
  estimatedTollCost: number;
  status: DispatchStatus;
  profit: number;
  coldChainRequired: boolean;
  startMileage: number | null;
  actualMileage: number | null;
  actualFuelCost: number | null;
  actualTollCost: number | null;
  laborCost: number | null;
  version: number;
}

@Injectable()
export class DispatchService implements TransactionalParticipant {
  private rows: DispatchOrderRow[] = [
    {
      id: 1,
      orderNo: 'DSP-20260612-0001',
      vehicleId: 1,
      driverId: 1,
      origin: '上海青浦仓',
      destination: '杭州萧山仓',
      planDepartAt: '2026-06-12 09:00',
      planArriveAt: '2026-06-12 13:30',
      actualDepartAt: null,
      actualArriveAt: null,
      cargo: '冷链食品',
      weight: 8200,
      volume: 42,
      freight: 7200,
      estimatedFuelCost: 1500,
      estimatedTollCost: 420,
      status: DispatchStatus.Assigned,
      profit: 0,
      coldChainRequired: true,
      startMileage: 88210,
      actualMileage: null,
      actualFuelCost: null,
      actualTollCost: null,
      laborCost: null,
      version: 1
    }
  ];

  constructor(
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly costService: CostService
  ) {}

  findAll(): DispatchOrderRow[] {
    return this.rows;
  }

  findOne(id: number): DispatchOrderRow | undefined {
    return this.rows.find((item) => item.id === id);
  }

  create(payload: Partial<DispatchOrderRow>): DispatchOrderRow {
    const id = this.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    const row: DispatchOrderRow = {
      id,
      orderNo: payload.orderNo ?? `DSP-${id}`,
      vehicleId: payload.vehicleId ?? null,
      driverId: payload.driverId ?? null,
      origin: payload.origin ?? '',
      destination: payload.destination ?? '',
      planDepartAt: payload.planDepartAt ?? '',
      planArriveAt: payload.planArriveAt ?? '',
      actualDepartAt: payload.actualDepartAt ?? null,
      actualArriveAt: payload.actualArriveAt ?? null,
      cargo: payload.cargo ?? '',
      weight: payload.weight ?? 0,
      volume: payload.volume ?? 0,
      freight: payload.freight ?? 0,
      estimatedFuelCost: payload.estimatedFuelCost ?? 0,
      estimatedTollCost: payload.estimatedTollCost ?? 0,
      status: (payload.status as DispatchStatus) ?? DispatchStatus.Draft,
      profit: payload.profit ?? 0,
      coldChainRequired: payload.coldChainRequired ?? false,
      startMileage: payload.startMileage ?? null,
      actualMileage: payload.actualMileage ?? null,
      actualFuelCost: payload.actualFuelCost ?? null,
      actualTollCost: payload.actualTollCost ?? null,
      laborCost: payload.laborCost ?? null,
      version: payload.version ?? 1
    };
    this.rows.push(row);
    return row;
  }

  /** 事务参与方：快照全部调度单行 */
  snapshot(): unknown {
    return this.rows.map((row) => ({ ...row }));
  }

  /** 事务参与方：回滚时整体恢复 */
  restore(checkpoint: unknown): void {
    this.rows = (checkpoint as DispatchOrderRow[]).map((row) => ({ ...row }));
  }

  private getOrderOrThrow(id: number): DispatchOrderRow {
    const order = this.findOne(id);
    if (!order) {
      throw new NotFoundException(`调度单 ${id} 不存在`);
    }
    return order;
  }

  private static monthOf(value: string): string {
    return value.slice(0, 7);
  }

  /**
   * 派单（Draft -> Assigned）：同一事务内校验并占用车辆、司机。
   * 校验项：车辆空闲、司机空闲、冷链货物必须匹配冷藏车。
   * 任一校验失败或并发抢占，车辆/司机占用与调度单状态一并回滚。
   */
  async assign(id: number, payload: AssignOrderPayload): Promise<DispatchOrderRow> {
    if (!payload || !Number.isInteger(payload.vehicleId) || !Number.isInteger(payload.driverId)) {
      throw new BadRequestException('派单必须提供有效的 vehicleId 与 driverId');
    }
    const order = this.getOrderOrThrow(id);
    if (order.status !== DispatchStatus.Draft) {
      throw new ConflictException(`调度单当前状态为 ${order.status}，只有草稿单可以派单，禁止重复派单`);
    }
    const transaction = new InMemoryTransaction();
    return transaction.execute(() => {
      transaction.enlist(this);
      transaction.enlist(this.vehicleService);
      transaction.enlist(this.driverService);
      const vehicle = this.vehicleService.acquireForDispatch(payload.vehicleId, order.id);
      if (!isCargoVehicleCompatible(order.cargo, vehicle.vehicleType)) {
        throw new ConflictException(`货物「${order.cargo}」为冷链货物，必须指派冷藏车（Refrigerated）`);
      }
      this.driverService.acquireForDispatch(payload.driverId, order.id);
      order.vehicleId = vehicle.id;
      order.driverId = payload.driverId;
      order.status = DispatchStatus.Assigned;
      order.coldChainRequired = isColdChainCargo(order.cargo);
      order.startMileage = vehicle.mileage;
      order.version += 1;
      return order;
    });
  }

  /** 开始运输（Assigned -> InProgress）：记录实际出发时间与出发里程 */
  start(id: number, payload: StartOrderPayload): DispatchOrderRow {
    const order = this.getOrderOrThrow(id);
    if (order.status === DispatchStatus.Completed || order.status === DispatchStatus.Cancelled) {
      throw new ConflictException(`调度单已${order.status === DispatchStatus.Completed ? '完成' : '取消'}，不能再开始运输`);
    }
    if (order.status !== DispatchStatus.Assigned) {
      throw new ConflictException(`调度单当前状态为 ${order.status}，只有已派单状态可以开始运输`);
    }
    if (!payload || !payload.actualDepartAt || Number.isNaN(new Date(payload.actualDepartAt).getTime())) {
      throw new BadRequestException('开始运输必须提供有效的 actualDepartAt');
    }
    if (!Number.isFinite(payload.startMileage) || payload.startMileage < 0) {
      throw new BadRequestException('开始运输必须提供有效的 startMileage');
    }
    order.actualDepartAt = payload.actualDepartAt;
    order.startMileage = payload.startMileage;
    order.status = DispatchStatus.InProgress;
    order.version += 1;
    return order;
  }

  /**
   * 完成结算（InProgress -> Completed）：四项状态在同一事务内提交——
   * 1) 按实际里程重算油费、路费、人工、利润并写回调度单；
   * 2) 写/更新车辆当月费用汇总；
   * 3) 按到达里程推进车辆累计里程并释放车辆；
   * 4) 释放司机。
   * 里程倒挂、重复完成、车辆/司机被并发抢占均抛 409，四项状态全部回滚。
   */
  async complete(id: number, payload: CompleteOrderPayload): Promise<DispatchOrderRow> {
    if (!payload || !payload.actualArriveAt || Number.isNaN(new Date(payload.actualArriveAt).getTime())) {
      throw new BadRequestException('完成结算必须提供有效的 actualArriveAt');
    }
    if (!Number.isFinite(payload.endMileage) || payload.endMileage < 0) {
      throw new BadRequestException('完成结算必须提供有效的 endMileage');
    }
    const order = this.getOrderOrThrow(id);
    if (order.status === DispatchStatus.Completed) {
      throw new ConflictException('调度单已完成结算，禁止重复完成');
    }
    if (order.status === DispatchStatus.Cancelled) {
      throw new ConflictException('调度单已取消，不能完成结算');
    }
    if (order.status !== DispatchStatus.InProgress) {
      throw new ConflictException(`调度单当前状态为 ${order.status}，只有运输中的调度单可以完成结算`);
    }
    if (!order.vehicleId || !order.driverId || order.startMileage === null || !order.actualDepartAt) {
      throw new ConflictException('调度单缺少派单或出发信息，无法完成结算');
    }

    const transaction = new InMemoryTransaction();
    return transaction.execute(() => {
      transaction.enlist(this);
      transaction.enlist(this.vehicleService);
      transaction.enlist(this.driverService);
      transaction.enlist(this.costService);
      const startMileage = order.startMileage as number;
      const actualMileage = resolveActualMileage(startMileage, payload.endMileage);
      if (actualMileage === null) {
        throw new ConflictException(
          `里程倒挂：到达里程 ${payload.endMileage} 小于出发里程 ${startMileage}，结算中止`
        );
      }
      const vehicleVersion = this.vehicleService.findOne(order.vehicleId as number)?.version ?? 0;
      const driverVersion = this.driverService.findOne(order.driverId as number)?.version ?? 0;
      const vehicle = this.vehicleService.assertHeld(
        order.vehicleId as number,
        order.id,
        vehicleVersion
      );
      const driver = this.driverService.assertHeld(
        order.driverId as number,
        order.id,
        driverVersion
      );
      const tripDays = resolveTripDays(order.actualDepartAt as string, payload.actualArriveAt);
      const settlement: OrderSettlement = recalculateSettlement({
        actualMileage,
        vehicleType: vehicle.vehicleType,
        freight: order.freight,
        monthlySalary: driver.monthlySalary,
        tripDays
      });

      this.costService.settleTrip({
        vehicleId: vehicle.id,
        month: DispatchService.monthOf(payload.actualArriveAt),
        freight: order.freight,
        fuelCost: settlement.actualFuelCost,
        tollCost: settlement.actualTollCost,
        laborCost: settlement.laborCost,
        dailyFixedCost: vehicle.dailyFixedCost,
        tripDays
      });
      this.vehicleService.settleAndRelease(
        vehicle.id,
        order.id,
        vehicleVersion,
        payload.endMileage
      );
      this.driverService.releaseAfterSettlement(driver.id, order.id, driverVersion);

      order.actualArriveAt = payload.actualArriveAt;
      order.actualMileage = actualMileage;
      order.actualFuelCost = settlement.actualFuelCost;
      order.actualTollCost = settlement.actualTollCost;
      order.laborCost = settlement.laborCost;
      order.profit = settlement.profit;
      order.status = DispatchStatus.Completed;
      order.version += 1;
      return order;
    });
  }

  /**
   * 取消调度单（Draft/Assigned/InProgress -> Cancelled）：不结算、不写费用汇总，
   * 只在同一事务内释放车辆与司机。已完成的单子不允许取消。
   */
  async cancel(id: number): Promise<DispatchOrderRow> {
    const order = this.getOrderOrThrow(id);
    if (order.status === DispatchStatus.Completed) {
      throw new ConflictException('调度单已完成结算，不能取消');
    }
    if (order.status === DispatchStatus.Cancelled) {
      throw new ConflictException('调度单已取消，禁止重复取消');
    }
    const transaction = new InMemoryTransaction();
    return transaction.execute(() => {
      transaction.enlist(this);
      transaction.enlist(this.vehicleService);
      transaction.enlist(this.driverService);
      if (order.vehicleId) {
        const version = this.vehicleService.findOne(order.vehicleId)?.version ?? 0;
        this.vehicleService.release(order.vehicleId, order.id, version);
      }
      if (order.driverId) {
        const version = this.driverService.findOne(order.driverId)?.version ?? 0;
        this.driverService.release(order.driverId, order.id, version);
      }
      order.status = DispatchStatus.Cancelled;
      order.version += 1;
      return order;
    });
  }

  /** 调度单详情：含实际到达时间与四类金额（未结算时金额为 null） */
  getDetail(id: number): DispatchOrderRow {
    return this.getOrderOrThrow(id);
  }
}
