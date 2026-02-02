/**
 * OrdersPanel - Display orders for the current turn.
 *
 * Shows all submitted orders with filtering by power.
 */

import type { Order, Power as UIPower } from '../../types/game';
import { type LowercasePower, UI_POWERS, POWER_COLORS } from '../../spectator/types';
import { PowerBadge } from '../shared/PowerBadge';

interface OrdersPanelProps {
  /** Orders for the current turn */
  orders: Order[];
  /** Units to determine which power issued each order */
  units: { power: UIPower; territory: string }[];
  /** Filter to specific power */
  filterPower?: LowercasePower;
  /** Callback when filter changes */
  onFilterChange?: (power: LowercasePower | undefined) => void;
  /** Whether orders have been resolved */
  resolved?: boolean;
  /** Order resolution results */
  resolutions?: Map<string, { success: boolean; reason?: string }>;
  className?: string;
}

export function OrdersPanel({
  orders,
  units,
  filterPower,
  onFilterChange,
  resolved = false,
  resolutions,
  className = '',
}: OrdersPanelProps) {
  // Map territories to powers
  const territoryToPower = new Map<string, LowercasePower>();
  for (const unit of units) {
    territoryToPower.set(unit.territory, unit.power);
  }

  // Group orders by power
  const ordersByPower = new Map<LowercasePower, Order[]>();
  for (const order of orders) {
    const power = territoryToPower.get(order.unit);
    if (power) {
      if (!ordersByPower.has(power)) {
        ordersByPower.set(power, []);
      }
      ordersByPower.get(power)!.push(order);
    }
  }

  // Filter orders
  const displayedOrders = filterPower
    ? ordersByPower.get(filterPower) || []
    : orders;

  return (
    <div className={`bg-gray-800 rounded-lg ${className}`}>
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Orders</h3>
        <span className="text-xs text-gray-500">{orders.length} total</span>
      </div>

      {/* Power filter */}
      <div className="px-4 py-2 border-b border-gray-700 flex flex-wrap gap-1">
        <button
          onClick={() => onFilterChange?.(undefined)}
          className={`
            px-2 py-1 text-xs rounded transition-colors
            ${!filterPower ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}
          `}
        >
          All
        </button>
        {UI_POWERS.map((power) => {
          const count = ordersByPower.get(power)?.length || 0;
          if (count === 0) return null;
          return (
            <button
              key={power}
              onClick={() => onFilterChange?.(filterPower === power ? undefined : power)}
              className={`
                px-2 py-1 text-xs rounded transition-colors flex items-center gap-1
                ${filterPower === power ? 'bg-gray-600' : 'hover:bg-gray-700'}
              `}
            >
              <PowerBadge power={power} size="sm" />
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Orders list */}
      <div className="p-2 max-h-64 overflow-y-auto">
        {displayedOrders.length === 0 ? (
          <div className="text-center py-4 text-gray-500 text-sm">
            No orders submitted
          </div>
        ) : (
          <div className="space-y-1">
            {displayedOrders.map((order, idx) => {
              const power = territoryToPower.get(order.unit);
              const resolution = resolutions?.get(order.unit);
              return (
                <OrderRow
                  key={`${order.unit}-${idx}`}
                  order={order}
                  power={power}
                  resolved={resolved}
                  success={resolution?.success}
                  reason={resolution?.reason}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface OrderRowProps {
  order: Order;
  power?: LowercasePower;
  resolved?: boolean;
  success?: boolean;
  reason?: string;
}

function OrderRow({ order, power, resolved, success, reason }: OrderRowProps) {
  const orderText = formatOrder(order);

  return (
    <div
      className={`
        flex items-center gap-2 px-2 py-1.5 rounded text-sm
        ${resolved
          ? success
            ? 'bg-green-900/20'
            : 'bg-red-900/20'
          : 'bg-gray-700/50'
        }
      `}
      title={reason}
    >
      {power && <PowerBadge power={power} size="sm" />}
      <span className="font-mono text-xs flex-1">{orderText}</span>
      {resolved && (
        <span className={success ? 'text-green-400' : 'text-red-400'}>
          {success ? '✓' : '✗'}
        </span>
      )}
    </div>
  );
}

/**
 * Formats an order as a readable string.
 */
function formatOrder(order: Order): string {
  const unit = order.unit.toUpperCase();

  switch (order.type) {
    case 'hold':
      return `${unit} HOLD`;
    case 'move':
      return `${unit} → ${order.target?.toUpperCase() || '?'}`;
    case 'support':
      if (order.supportTarget) {
        return `${unit} S ${order.target?.toUpperCase()} → ${order.supportTarget.toUpperCase()}`;
      }
      return `${unit} S ${order.target?.toUpperCase()} H`;
    case 'convoy':
      return `${unit} C ${order.target?.toUpperCase()} → ${order.supportTarget?.toUpperCase() || '?'}`;
    default:
      return `${unit} ???`;
  }
}

/**
 * Compact orders summary for mobile.
 */
interface OrdersSummaryProps {
  orders: Order[];
  units: { power: UIPower; territory: string }[];
  className?: string;
}

export function OrdersSummary({ orders, units, className = '' }: OrdersSummaryProps) {
  const territoryToPower = new Map<string, LowercasePower>();
  for (const unit of units) {
    territoryToPower.set(unit.territory, unit.power);
  }

  // Count by power
  const counts = new Map<LowercasePower, number>();
  for (const order of orders) {
    const power = territoryToPower.get(order.unit);
    if (power) {
      counts.set(power, (counts.get(power) || 0) + 1);
    }
  }

  return (
    <div className={`flex items-center gap-3 text-xs ${className}`}>
      <span className="text-gray-400">{orders.length} orders</span>
      <div className="flex gap-1">
        {UI_POWERS.map((power) => {
          const count = counts.get(power);
          if (!count) return null;
          return (
            <span key={power} className="flex items-center gap-0.5">
              <span
                className="w-2 h-2 rounded"
                style={{ backgroundColor: POWER_COLORS[power] }}
              />
              <span>{count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
