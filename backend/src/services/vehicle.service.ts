import { Injectable } from '@nestjs/common';
import { VehicleStatus } from '../types/enums';

@Injectable()
export class VehicleService {
  private rows: any[] = [{ id: 1, plateNo: '沪A-7821', vehicleType: 'Refrigerated', brandModel: '东风天锦 KR', purchaseDate: '2023-03-12', insuranceExpireDate: '2026-09-30', inspectionExpireDate: '2026-11-20', status: 'Available', mileage: 88210, tankCapacity: 380, dailyFixedCost: 260, lockedByOrderId: null }];
  findAll() { return this.rows; }
  findOne(id: number) { return this.rows.find((item: any) => item.id === id); }
  create(payload: any) { const row = { status: VehicleStatus.Available, lockedByOrderId: null, ...payload, id: this.rows.length + 1 }; this.rows.push(row); return row; }

  isIdle(id: number) {
    const row: any = this.findOne(id);
    return !!row && row.status === VehicleStatus.Available && !row.lockedByOrderId;
  }

  lockForOrder(id: number, orderId: number) {
    const row: any = this.findOne(id);
    if (!row || row.status !== VehicleStatus.Available || row.lockedByOrderId) return false;
    row.status = VehicleStatus.OnTrip;
    row.lockedByOrderId = orderId;
    return true;
  }

  releaseFromOrder(id: number, orderId: number) {
    const row: any = this.findOne(id);
    if (!row || row.lockedByOrderId !== orderId) return false;
    row.status = VehicleStatus.Available;
    row.lockedByOrderId = null;
    return true;
  }

  advanceMileage(id: number, endMileage: number) {
    const row: any = this.findOne(id);
    if (!row || endMileage < row.mileage) return false;
    row.mileage = endMileage;
    return true;
  }
}
