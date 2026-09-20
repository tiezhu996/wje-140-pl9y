import { Injectable } from '@nestjs/common';
import { DriverStatus } from '../types/enums';

@Injectable()
export class DriverService {
  private rows: any[] = [{ id: 1, name: '赵强', phone: '13800000001', identityNo: '310101199001010011', licenseType: 'B2', licenseExpireDate: '2028-05-01', hireDate: '2022-01-10', status: 'Available', monthlySalary: 9800, lockedByOrderId: null }];
  findAll() { return this.rows; }
  findOne(id: number) { return this.rows.find((item: any) => item.id === id); }
  create(payload: any) { const row = { status: DriverStatus.Available, lockedByOrderId: null, ...payload, id: this.rows.length + 1 }; this.rows.push(row); return row; }

  isIdle(id: number) {
    const row: any = this.findOne(id);
    return !!row && row.status === DriverStatus.Available && !row.lockedByOrderId;
  }

  lockForOrder(id: number, orderId: number) {
    const row: any = this.findOne(id);
    if (!row || row.status !== DriverStatus.Available || row.lockedByOrderId) return false;
    row.status = DriverStatus.OnTrip;
    row.lockedByOrderId = orderId;
    return true;
  }

  releaseFromOrder(id: number, orderId: number) {
    const row: any = this.findOne(id);
    if (!row || row.lockedByOrderId !== orderId) return false;
    row.status = DriverStatus.Available;
    row.lockedByOrderId = null;
    return true;
  }
}
