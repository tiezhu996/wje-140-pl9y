import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus } from '../types/enums';
import { TransactionalParticipant } from '../utils/transaction';

export interface DriverRow {
  id: number;
  name: string;
  phone: string;
  identityNo: string;
  licenseType: string;
  licenseExpireDate: string;
  hireDate: string;
  status: DriverStatus;
  monthlySalary: number;
  currentDispatchId: number | null;
  version: number;
}

@Injectable()
export class DriverService implements TransactionalParticipant {
  private rows: DriverRow[] = [
    {
      id: 1,
      name: '赵强',
      phone: '13800000001',
      identityNo: '310101199001010011',
      licenseType: 'B2',
      licenseExpireDate: '2028-05-01',
      hireDate: '2022-01-10',
      status: DriverStatus.OnTrip,
      monthlySalary: 9800,
      currentDispatchId: 1,
      version: 1
    }
  ];

  findAll(): DriverRow[] {
    return this.rows;
  }

  findOne(id: number): DriverRow | undefined {
    return this.rows.find((item) => item.id === id);
  }

  create(payload: Partial<DriverRow>): DriverRow {
    const id = this.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    const row: DriverRow = {
      id,
      name: payload.name ?? '',
      phone: payload.phone ?? '',
      identityNo: payload.identityNo ?? '',
      licenseType: payload.licenseType ?? 'C1',
      licenseExpireDate: payload.licenseExpireDate ?? '',
      hireDate: payload.hireDate ?? '',
      status: (payload.status as DriverStatus) ?? DriverStatus.Available,
      monthlySalary: payload.monthlySalary ?? 0,
      currentDispatchId: payload.currentDispatchId ?? null,
      version: payload.version ?? 1
    };
    this.rows.push(row);
    return row;
  }

  /** 事务参与方：快照全部司机行 */
  snapshot(): unknown {
    return this.rows.map((row) => ({ ...row }));
  }

  /** 事务参与方：回滚时整体恢复 */
  restore(checkpoint: unknown): void {
    this.rows = (checkpoint as DriverRow[]).map((row) => ({ ...row }));
  }

  /**
   * 派单占用司机：司机必须处于空闲（Available）状态。
   * 在途/休假/停职状态均视为不可派单，按冲突返回 409。
   */
  acquireForDispatch(driverId: number, orderId: number): DriverRow {
    const driver = this.findOne(driverId);
    if (!driver) {
      throw new NotFoundException(`司机 ${driverId} 不存在`);
    }
    if (driver.status !== DriverStatus.Available) {
      throw new ConflictException(
        `司机 ${driver.name} 当前状态为 ${driver.status}，无法派单（可能已被其他调度单抢占）`
      );
    }
    driver.status = DriverStatus.OnTrip;
    driver.currentDispatchId = orderId;
    driver.version += 1;
    return driver;
  }

  /** 事务内防御性校验：司机必须仍由该调度单占用且版本号一致 */
  assertHeld(driverId: number, orderId: number, expectedVersion: number): DriverRow {
    const driver = this.findOne(driverId);
    if (!driver || driver.version !== expectedVersion || driver.currentDispatchId !== orderId) {
      throw new ConflictException(`司机资源已被并发抢占或状态已变更，调度单 ${orderId} 结算中止`);
    }
    return driver;
  }

  /** 完成结算后释放司机，回到空闲池 */
  releaseAfterSettlement(driverId: number, orderId: number, expectedVersion: number): DriverRow {
    const driver = this.assertHeld(driverId, orderId, expectedVersion);
    driver.status = DriverStatus.Available;
    driver.currentDispatchId = null;
    driver.version += 1;
    return driver;
  }

  /** 取消派单：只释放司机，不写结算数据 */
  release(driverId: number, orderId: number, expectedVersion: number): void {
    const driver = this.findOne(driverId);
    if (!driver) {
      return;
    }
    if (driver.currentDispatchId === orderId && driver.version === expectedVersion) {
      driver.status = DriverStatus.Available;
      driver.currentDispatchId = null;
      driver.version += 1;
    }
  }
}
