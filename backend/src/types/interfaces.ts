export type Role = 'Admin' | 'FleetManager' | 'Dispatcher' | 'Driver' | 'Mechanic';
export interface AuthUser { id: number; role: Role; name: string; }
export interface ApiResult<T> { data: T; message: string; }

export interface CompleteTripPayload { endMileage: number; actualArriveAt?: string; }

export interface SettlementBreakdown {
  tripDistance: number;
  fuelCost: number;
  tollCost: number;
  laborCost: number;
  profit: number;
}
