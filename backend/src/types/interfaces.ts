export type Role = 'Admin' | 'FleetManager' | 'Dispatcher' | 'Driver' | 'Mechanic';
export interface AuthUser { id: number; role: Role; name: string; }
export interface ApiResult<T> { data: T; message: string; }

/** 派单入参：选定车辆与司机 */
export interface AssignOrderPayload {
  vehicleId: number;
  driverId: number;
}

/** 开始运输入参：实际出发时间与出发里程 */
export interface StartOrderPayload {
  actualDepartAt: string;
  startMileage: number;
}

/** 完成运输入参：实际到达时间与到达里程 */
export interface CompleteOrderPayload {
  actualArriveAt: string;
  endMileage: number;
}

/** 完成后回算出的四类金额 */
export interface OrderSettlement {
  actualFuelCost: number;
  actualTollCost: number;
  laborCost: number;
  profit: number;
}
