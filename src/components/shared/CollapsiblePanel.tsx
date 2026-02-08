/**
 * CollapsiblePanel - A panel with a clickable header to collapse/expand content.
 *
 * Used in the spectator sidebar to allow users to hide panels they don't need.
 */

import { useState, type ReactNode } from 'react';

interface CollapsiblePanelProps {
  /** Panel title displayed in header */
  title: string;
  /** Optional count badge to show in header */
  count?: number;
  /** Panel content */
  children: ReactNode;
  /** Whether the panel starts collapsed */
  defaultCollapsed?: boolean;
  /** Controlled collapsed state */
  collapsed?: boolean;
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Additional CSS classes for the container */
  className?: string;
}

export function CollapsiblePanel({
  title,
  count,
  children,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  className = '',
}: CollapsiblePanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

  // Support both controlled and uncontrolled modes
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const handleToggle = () => {
    const newValue = !isCollapsed;
    if (onCollapsedChange) {
      onCollapsedChange(newValue);
    } else {
      setInternalCollapsed(newValue);
    }
  };

  return (
    <div className={`bg-gray-800 ${className}`}>
      <button
        onClick={handleToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronIcon collapsed={isCollapsed} />
          <h2 className="font-semibold text-sm">{title}</h2>
        </div>
        {count !== undefined && (
          <span className="text-xs text-gray-500">{count}</span>
        )}
      </button>
      {!isCollapsed && (
        <div className="border-t border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}
