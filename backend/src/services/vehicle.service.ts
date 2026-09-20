import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { VehicleStatus } from '../types/enums';
import { TransactionalParticipant } from '../utils/transaction';

export interface VehicleRow {
  id: number;
  plateNo: string;
  vehicleType: string;
  brandModel: string;
  purchaseDate: string;
  insuranceExpireDate: string;
  inspectionExpireDate: string;
  status: VehicleStatus;
  mileage: number;
  tankCapacity: number;
  dailyFixedCost: number;
  currentDispatchId: number | null;
  version: number;
}

@Injectable()
export class VehicleService implements TransactionalParticipant {
  private rows: VehicleRow[] = [
    {
      id: 1,
      plateNo: '沪A-7821',
      vehicleType: 'Refrigerated',
      brandModel: '东风天锦 KR',
      purchaseDate: '2023-03-12',
      insuranceExpireDate: '2026-09-30',
      inspectionExpireDate: '2026-11-20',
      status: VehicleStatus.OnTrip,
      mileage: 88210,
      tankCapacity: 380,
      dailyFixedCost: 260,
      currentDispatchId: 1,
      version: 1
    }
  ];

  findAll(): VehicleRow[] {
    return this.rows;
  }

  findOne(id: number): VehicleRow | undefined {
    return this.rows.find((item) => item.id === id);
  }

  create(payload: Partial<VehicleRow>): VehicleRow {
    const id = this.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    const row: VehicleRow = {
      id,
      plateNo: payload.plateNo ?? '',
      vehicleType: payload.vehicleType ?? 'LightTruck',
      brandModel: payload.brandModel ?? '',
      purchaseDate: payload.purchaseDate ?? '',
      insuranceExpireDate: payload.insuranceExpireDate ?? '',
      inspectionExpireDate: payload.inspectionExpireDate ?? '',
      status: (payload.status as VehicleStatus) ?? VehicleStatus.Available,
      mileage: payload.mileage ?? 0,
      tankCapacity: payload.tankCapacity ?? 0,
      dailyFixedCost: payload.dailyFixedCost ?? 0,
      currentDispatchId: payload.currentDispatchId ?? null,
      version: payload.version ?? 1
    };
    this.rows.push(row);
    return row;
  }

  /** 事务参与方：快照全部车辆行 */
  snapshot(): unknown {
    return this.rows.map((row) => ({ ...row }));
  }

  /** 事务参与方：回滚时整体恢复 */
  restore(checkpoint: unknown): void {
    this.rows = (checkpoint as VehicleRow[]).map((row) => ({ ...row }));
  }

  /**
   * 派单占用车辆：车辆必须处于空闲（Available）状态。
   * 任何非空闲状态（在途/维保/退役）都按并发抢占冲突返回 409。
   */
  acquireForDispatch(vehicleId: number, orderId: number): VehicleRow {
    const vehicle = this.findOne(vehicleId);
    if (!vehicle) {
      throw new NotFoundException(`车辆 ${vehicleId} 不存在`);
    }
    if (vehicle.status !== VehicleStatus.Available) {
      throw new ConflictException(
        `车辆 ${vehicle.plateNo} 当前状态为 ${vehicle.status}，无法派单（可能已被其他调度单抢占）`
      );
    }
    vehicle.status = VehicleStatus.OnTrip;
    vehicle.currentDispatchId = orderId;
    vehicle.version += 1;
    return vehicle;
  }

  /** 事务内防御性校验：车辆必须仍由该调度单占用，版本号一致，否则判定被并发抢占 */
  assertHeld(vehicleId: number, orderId: number, expectedVersion: number): VehicleRow {
    const vehicle = this.findOne(vehicleId);
    if (!vehicle || vehicle.version !== expectedVersion || vehicle.currentDispatchId !== orderId) {
      throw new ConflictException(`车辆资源已被并发抢占或状态已变更，调度单 ${orderId} 结算中止`);
    }
    return vehicle;
  }

  /** 完成结算：校验版本与占用关系，推进累计里程后释放车辆 */
  settleAndRelease(
    vehicleId: number,
    orderId: number,
    expectedVersion: number,
    endMileage: number
  ): VehicleRow {
    const vehicle = this.assertHeld(vehicleId, orderId, expectedVersion);
    vehicle.mileage = endMileage;
    vehicle.status = VehicleStatus.Available;
    vehicle.currentDispatchId = null;
    vehicle.version += 1;
    return vehicle;
  }

  /** 取消派单：只释放车辆，不触发任何结算写入 */
  release(vehicleId: number, orderId: number, expectedVersion: number): void {
    const vehicle = this.findOne(vehicleId);
    if (!vehicle) {
      return;
    }
    if (vehicle.currentDispatchId === orderId && vehicle.version === expectedVersion) {
      vehicle.status = VehicleStatus.Available;
      vehicle.currentDispatchId = null;
      vehicle.version += 1;
    }
  }
}
