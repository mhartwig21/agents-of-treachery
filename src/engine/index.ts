/**
 * Diplomacy Game Engine
 *
 * A standalone game engine for the classic board game Diplomacy.
 * Supports order adjudication, retreat resolution, builds/disbands,
 * and victory detection.
 */

// Types
export type {
  Power,
  UnitType,
  ProvinceType,
  Coast,
  Province,
  Unit,
  OrderType,
  HoldOrder,
  MoveOrder,
  SupportOrder,
  ConvoyOrder,
  Order,
  Phase,
  Season,
  RetreatOrder,
  BuildOrder,
  OrderResolution,
  GameState,
} from './types';

// Constants
export { POWERS } from './types';

// Map data
export {
  PROVINCES,
  ADJACENCIES,
  getProvince,
  getSupplyCenters,
  getHomeCenters,
  getAdjacent,
  areAdjacent,
  canArmyOccupy,
  canFleetOccupy,
} from './map';

// Adjudicator
export {
  validateOrder,
  adjudicate,
  getRetreatOptions,
  calculateBuildCounts,
} from './adjudicator';

// Game management
export {
  createInitialState,
  submitOrders,
  allOrdersSubmitted,
  resolveMovement,
  submitRetreats,
  resolveRetreats,
  submitBuilds,
  resolveBuilds,
  checkVictory,
  getSupplyCenterCounts,
  getUnitCounts,
  cloneState,
} from './game';
