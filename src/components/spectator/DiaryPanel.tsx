/**
 * DiaryPanel - Display per-power agent diary entries.
 *
 * Shows diary entries chronologically with phase badges and type indicators.
 * Year summaries are shown as expandable blocks.
 */

import { useState } from 'react';
import type { DiaryEntry, YearSummary } from '../../agent/types';
import { type LowercasePower, UI_POWERS } from '../../spectator/types';
import { PowerBadge } from '../shared/PowerBadge';

interface DiaryPanelProps {
  /** Diary data per power (uppercase power keys from engine) */
  diaries: Record<string, { entries: DiaryEntry[]; yearSummaries: YearSummary[] }>;
  className?: string;
}

/** Badge colors for diary entry types */
const TYPE_COLORS: Record<string, string> = {
  negotiation: 'bg-blue-600',
  orders: 'bg-amber-600',
  reflection: 'bg-purple-600',
  planning: 'bg-green-600',
  consolidation: 'bg-gray-600',
};

export function DiaryPanel({ diaries, className = '' }: DiaryPanelProps) {
  const [selectedPower, setSelectedPower] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  // Find powers that have diary data (keys are uppercase engine powers)
  const powersWithData = UI_POWERS.filter(
    (p) => diaries[p.toUpperCase()]?.entries.length || diaries[p.toUpperCase()]?.yearSummaries.length
  );

  if (powersWithData.length === 0) {
    return (
      <div className={`bg-gray-800 ${className}`}>
        <div className="text-center py-4 text-gray-500 text-sm">
          No diary entries yet
        </div>
      </div>
    );
  }

  // Auto-select first power if none selected
  const activePower = selectedPower ?? powersWithData[0];
  const powerKey = activePower.toUpperCase();
  const data = diaries[powerKey];
  const entries = data?.entries ?? [];
  const yearSummaries = data?.yearSummaries ?? [];

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <div className={`bg-gray-800 ${className}`}>
      {/* Power selector */}
      <div className="px-4 py-2 border-b border-gray-700 flex flex-wrap gap-1">
        {powersWithData.map((power) => {
          const count = diaries[power.toUpperCase()]?.entries.length ?? 0;
          return (
            <button
              key={power}
              onClick={() => setSelectedPower(power)}
              className={`
                px-2 py-1 text-xs rounded transition-colors flex items-center gap-1
                ${activePower === power ? 'bg-gray-600' : 'hover:bg-gray-700'}
              `}
            >
              <PowerBadge power={power as LowercasePower} size="sm" />
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Year summaries */}
      {yearSummaries.length > 0 && (
        <div className="border-b border-gray-700">
          {yearSummaries.map((summary) => (
            <div key={summary.year}>
              <button
                onClick={() => toggleYear(summary.year)}
                className="w-full px-4 py-2 text-left text-xs hover:bg-gray-700/50 transition-colors flex items-center gap-2"
              >
                <span className={`transition-transform ${expandedYears.has(summary.year) ? '' : '-rotate-90'}`}>
                  &#9662;
                </span>
                <span className="font-semibold text-yellow-400">Year {summary.year} Summary</span>
              </button>
              {expandedYears.has(summary.year) && (
                <div className="px-4 pb-2 text-xs text-gray-300 whitespace-pre-wrap">
                  {summary.summary}
                  {summary.territorialChanges.length > 0 && (
                    <div className="mt-1 text-gray-400">
                      Territorial: {summary.territorialChanges.join(', ')}
                    </div>
                  )}
                  {summary.diplomaticChanges.length > 0 && (
                    <div className="mt-1 text-gray-400">
                      Diplomatic: {summary.diplomaticChanges.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Diary entries */}
      <div className="p-2 max-h-80 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="text-center py-4 text-gray-500 text-sm">
            No entries for {activePower}
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry, idx) => (
              <DiaryEntryRow key={`${entry.phase}-${entry.type}-${idx}`} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DiaryEntryRow({ entry }: { entry: DiaryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const typeColor = TYPE_COLORS[entry.type] ?? 'bg-gray-600';
  const preview = entry.content.length > 80
    ? entry.content.slice(0, 80) + '...'
    : entry.content;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left px-2 py-1.5 rounded bg-gray-700/50 hover:bg-gray-700 transition-colors"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-gray-400 flex-shrink-0">{entry.phase}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${typeColor}`}>
          {entry.type}
        </span>
      </div>
      <div className="text-xs text-gray-300 mt-1 whitespace-pre-wrap">
        {expanded ? entry.content : preview}
      </div>
    </button>
  );
}
