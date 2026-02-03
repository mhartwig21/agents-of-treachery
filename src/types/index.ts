/**
 * Unified type system for AoT.
 *
 * This module is the canonical source of truth for shared types.
 * It re-exports types from specialized modules and provides cross-cutting utilities.
 */

// Re-export engine types as the authoritative source
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
} from '../engine/types';

export { POWERS } from '../engine/types';

// Re-export UI types with explicit naming
export type {
  Power as UIPower,
  UnitType as UIUnitType,
  TerritoryType,
  OrderType as UIOrderType,
  Unit as UIUnit,
  Order as UIOrder,
  Territory,
  GameState as UIGameState,
} from './game';

/**
 * Result<T, E> - A discriminated union for typed error handling.
 *
 * Usage:
 * ```ts
 * function parseOrder(input: string): Result<Order, ParseError> {
 *   try {
 *     const order = parse(input);
 *     return { ok: true, value: order };
 *   } catch (e) {
 *     return { ok: false, error: { code: 'PARSE_ERROR', message: e.message } };
 *   }
 * }
 *
 * const result = parseOrder("A PAR - BUR");
 * if (result.ok) {
 *   submitOrder(result.value);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Helper to create a success result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Helper to create an error result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Standard error structure for Result<T, E> error types.
 */
export interface AppError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Type guard to narrow Result to success case.
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Type guard to narrow Result to error case.
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/**
 * Map a Result's value if successful.
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (result.ok) {
    return { ok: true, value: fn(result.value) };
  }
  return result;
}

/**
 * Unwrap a Result, throwing if it's an error.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwrap a Result with a default value if it's an error.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}
