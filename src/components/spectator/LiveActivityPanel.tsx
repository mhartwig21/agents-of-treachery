/**
 * LiveActivityPanel - Shows real-time game activity as it happens.
 *
 * Displays:
 * - Which agent is currently thinking
 * - Messages as they arrive
 * - Orders as they're submitted
 */

import { POWER_COLORS, type LowercasePower } from '../../spectator/types';
import type { Message } from '../../press/types';
import type { Order as UIOrder } from '../../types/game';

interface LiveActivityPanelProps {
  /** Which agent is currently thinking */
  currentAgent?: string;
  /** Recent messages as they arrive */
  latestMessages?: Message[];
  /** Recent orders as submitted */
  latestOrders?: Record<string, UIOrder[]>;
  /** Whether the game is in live mode */
  isLive: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function LiveActivityPanel({
  currentAgent,
  latestMessages,
  latestOrders,
  isLive,
  className = '',
}: LiveActivityPanelProps) {
  if (!isLive) {
    return null;
  }

  const hasActivity = currentAgent || (latestMessages && latestMessages.length > 0) || (latestOrders && Object.keys(latestOrders).length > 0);

  return (
    <div className={`bg-gray-800 p-3 ${className}`}>
      {!hasActivity ? (
        <div className="text-gray-500 text-sm italic">Waiting for agent activity...</div>
      ) : (
        <div className="space-y-2">
          {/* Current agent thinking */}
          {currentAgent && (
            <div className="flex items-center gap-2 text-sm">
              <AgentThinkingIndicator power={currentAgent.toLowerCase() as LowercasePower} />
            </div>
          )}

          {/* Latest messages */}
          {latestMessages && latestMessages.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-gray-500 uppercase">Recent Messages</div>
              {latestMessages.slice(-3).map((msg, i) => (
                <MessagePreview key={i} message={msg} />
              ))}
            </div>
          )}

          {/* Latest orders */}
          {latestOrders && Object.keys(latestOrders).length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-gray-500 uppercase">Orders Submitted</div>
              {Object.entries(latestOrders).map(([power, orders]) => (
                <OrdersPreview key={power} power={power as LowercasePower} orders={orders} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentThinkingIndicator({ power }: { power: LowercasePower }) {
  const color = POWER_COLORS[power] || '#666';

  return (
    <div className="flex items-center gap-2 bg-gray-700/50 rounded px-2 py-1">
      <div
        className="w-3 h-3 rounded-full animate-pulse"
        style={{ backgroundColor: color }}
      />
      <span className="text-sm">
        <span className="font-medium capitalize">{power}</span>
        <span className="text-gray-400"> is thinking...</span>
      </span>
      <ThinkingDots />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5 ml-1">
      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

function MessagePreview({ message }: { message: Message }) {
  const senderPower = message.sender.toLowerCase() as LowercasePower;
  const color = POWER_COLORS[senderPower] || '#666';

  return (
    <div className="text-xs bg-gray-700/30 rounded px-2 py-1 truncate">
      <span
        className="font-medium capitalize"
        style={{ color }}
      >
        {message.sender}
      </span>
      <span className="text-gray-400">: </span>
      <span className="text-gray-300">{message.content.slice(0, 50)}...</span>
    </div>
  );
}

function OrdersPreview({ power, orders }: { power: LowercasePower; orders: UIOrder[] }) {
  const color = POWER_COLORS[power] || '#666';

  return (
    <div className="text-xs bg-gray-700/30 rounded px-2 py-1">
      <span
        className="font-medium capitalize"
        style={{ color }}
      >
        {power}
      </span>
      <span className="text-gray-400">: {orders.length} order{orders.length !== 1 ? 's' : ''}</span>
    </div>
  );
}
