/**
 * Core types for the Diplomacy game engine.
 */

export type Power =
  | 'ENGLAND'
  | 'FRANCE'
  | 'GERMANY'
  | 'ITALY'
  | 'AUSTRIA'
  | 'RUSSIA'
  | 'TURKEY';

export const POWERS: Power[] = [
  'ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'
];

export type UnitType = 'ARMY' | 'FLEET';

export type ProvinceType = 'LAND' | 'SEA' | 'COASTAL';

export type Coast = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface Province {
  id: string;
  name: string;
  type: ProvinceType;
  supplyCenter: boolean;
  homeCenter?: Power;
  coasts?: Coast[];
}

export interface Unit {
  type: UnitType;
  power: Power;
  province: string;
  coast?: Coast;
}

export type OrderType = 'HOLD' | 'MOVE' | 'SUPPORT' | 'CONVOY';

export interface HoldOrder {
  type: 'HOLD';
  unit: string;
}

export interface MoveOrder {
  type: 'MOVE';
  unit: string;
  destination: string;
  destinationCoast?: Coast;
  viaConvoy?: boolean;
}

export interface SupportOrder {
  type: 'SUPPORT';
  unit: string;
  supportedUnit: string;
  destination?: string;
}

export interface ConvoyOrder {
  type: 'CONVOY';
  unit: string;
  convoyedUnit: string;
  destination: string;
}

export type Order = HoldOrder | MoveOrder | SupportOrder | ConvoyOrder;

export type Phase = 'DIPLOMACY' | 'MOVEMENT' | 'RETREAT' | 'BUILD';

export type Season = 'SPRING' | 'FALL' | 'WINTER';

export interface RetreatOrder {
  unit: string;
  destination?: string;
}

export interface BuildOrder {
  type: 'BUILD' | 'DISBAND';
  province?: string;
  unitType?: UnitType;
  coast?: Coast;
}

export interface OrderResolution {
  order: Order;
  success: boolean;
  reason?: string;
  dislodged?: boolean;
  dislodgedFrom?: string;
}

export interface GameState {
  year: number;
  season: Season;
  phase: Phase;
  units: Unit[];
  supplyCenters: Map<string, Power>;
  orders: Map<Power, Order[]>;
  retreats: Map<string, string[]>;
  pendingRetreats: Unit[];
  pendingBuilds: Map<Power, number>;
  winner?: Power;
  draw?: boolean;
}
