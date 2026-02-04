/**
 * GameEventOverlay - Visual flourishes for dramatic game events.
 *
 * Displays animated overlays for significant moments:
 * - Stabs (betrayals)
 * - Eliminations
 * - Solo victories
 * - Supply center captures
 */

import { useState, useEffect, useCallback } from 'react';
import type { DetectedGameEvent } from '../../audio/useGameSounds';
import type { LowercasePower } from '../../spectator/types';

/** Power display names */
const POWER_NAMES: Record<LowercasePower, string> = {
  england: 'England',
  france: 'France',
  germany: 'Germany',
  italy: 'Italy',
  austria: 'Austria',
  russia: 'Russia',
  turkey: 'Turkey',
};

interface GameEventOverlayProps {
  /** Recent game events to display */
  events: DetectedGameEvent[];
  /** How long to show each event (ms) */
  displayDuration?: number;
}

/** Visual state for a single event notification */
interface EventNotification {
  id: string;
  event: DetectedGameEvent;
  visible: boolean;
  exiting: boolean;
}

export function GameEventOverlay({
  events,
  displayDuration = 3000,
}: GameEventOverlayProps) {
  const [notifications, setNotifications] = useState<EventNotification[]>([]);

  // Add new events as notifications
  useEffect(() => {
    if (events.length === 0) return;

    // Filter to only show dramatic events
    const dramaticEvents = events.filter(
      (e) =>
        e.type === 'stab' ||
        e.type === 'elimination' ||
        e.type === 'solo_victory' ||
        e.type === 'draw' ||
        (e.type === 'capture' && e.details?.includes('from'))
    );

    if (dramaticEvents.length === 0) return;

    const newNotifications: EventNotification[] = dramaticEvents.map(
      (event, i) => ({
        id: `${Date.now()}-${i}`,
        event,
        visible: true,
        exiting: false,
      })
    );

    setNotifications((prev) => [...prev, ...newNotifications]);
  }, [events]);

  // Auto-dismiss notifications
  useEffect(() => {
    if (notifications.length === 0) return;

    const timeouts: NodeJS.Timeout[] = [];

    for (const notif of notifications) {
      if (!notif.exiting) {
        // Start exit animation
        const exitTimeout = setTimeout(() => {
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === notif.id ? { ...n, exiting: true } : n
            )
          );
        }, displayDuration - 500);
        timeouts.push(exitTimeout);

        // Remove completely
        const removeTimeout = setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
        }, displayDuration);
        timeouts.push(removeTimeout);
      }
    }

    return () => {
      for (const t of timeouts) {
        clearTimeout(t);
      }
    };
  }, [notifications, displayDuration]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, exiting: true } : n))
    );
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 500);
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-start justify-center pt-20">
      <div className="flex flex-col gap-4 items-center">
        {notifications.map((notif) => (
          <EventNotificationCard
            key={notif.id}
            notification={notif}
            onDismiss={() => dismissNotification(notif.id)}
          />
        ))}
      </div>

      {/* Full-screen flash for major events */}
      {notifications.some(
        (n) =>
          !n.exiting &&
          (n.event.type === 'solo_victory' || n.event.type === 'elimination')
      ) && <FullScreenFlash />}
    </div>
  );
}

interface EventNotificationCardProps {
  notification: EventNotification;
  onDismiss: () => void;
}

function EventNotificationCard({
  notification,
  onDismiss,
}: EventNotificationCardProps) {
  const { event, exiting } = notification;
  const config = getEventConfig(event);

  return (
    <div
      onClick={onDismiss}
      className={`
        pointer-events-auto cursor-pointer
        px-6 py-4 rounded-lg shadow-2xl
        border-2 backdrop-blur-sm
        transition-all duration-500
        ${exiting ? 'opacity-0 translate-y-[-20px] scale-95' : 'opacity-100 translate-y-0 scale-100'}
        ${config.bgClass} ${config.borderClass}
      `}
      style={{
        animation: exiting ? undefined : 'slideIn 0.5s ease-out',
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-3xl">{config.emoji}</span>
        <div>
          <div className={`text-lg font-bold ${config.textClass}`}>
            {config.title}
          </div>
          {config.subtitle && (
            <div className="text-sm text-gray-300">{config.subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface EventConfig {
  emoji: string;
  title: string;
  subtitle?: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}

function getEventConfig(event: DetectedGameEvent): EventConfig {
  const powerName = event.power ? POWER_NAMES[event.power] : '';

  switch (event.type) {
    case 'stab':
      return {
        emoji: '🗡️',
        title: 'BETRAYAL!',
        subtitle: event.details || `${powerName} strikes!`,
        bgClass: 'bg-red-900/90',
        borderClass: 'border-red-500',
        textClass: 'text-red-300',
      };

    case 'elimination':
      return {
        emoji: '💀',
        title: `${powerName} ELIMINATED`,
        subtitle: 'A power falls...',
        bgClass: 'bg-gray-900/90',
        borderClass: 'border-gray-500',
        textClass: 'text-gray-300',
      };

    case 'solo_victory':
      return {
        emoji: '👑',
        title: `${powerName} WINS!`,
        subtitle: 'Solo victory achieved!',
        bgClass: 'bg-yellow-900/90',
        borderClass: 'border-yellow-500',
        textClass: 'text-yellow-300',
      };

    case 'draw':
      return {
        emoji: '🤝',
        title: 'GAME DRAWN',
        subtitle: 'The powers agree to peace',
        bgClass: 'bg-blue-900/90',
        borderClass: 'border-blue-500',
        textClass: 'text-blue-300',
      };

    case 'capture':
      return {
        emoji: '🏴',
        title: 'Supply Center Captured!',
        subtitle: `${powerName} takes ${event.territory} ${event.details || ''}`,
        bgClass: 'bg-purple-900/90',
        borderClass: 'border-purple-500',
        textClass: 'text-purple-300',
      };

    default:
      return {
        emoji: '📢',
        title: event.type.toUpperCase(),
        subtitle: event.details,
        bgClass: 'bg-gray-800/90',
        borderClass: 'border-gray-600',
        textClass: 'text-gray-300',
      };
  }
}

function FullScreenFlash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(false), 300);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 bg-white/20 pointer-events-none"
      style={{
        animation: 'flashFade 0.3s ease-out forwards',
      }}
    />
  );
}

// Add CSS animations via style tag
const styleId = 'game-event-overlay-styles';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px) scale(0.9);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes flashFade {
      from {
        opacity: 0.3;
      }
      to {
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
