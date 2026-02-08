# Design: Negotiation Analysis for Incoming Messages

**Issue:** aot-mol-m9j
**Status:** Design
**Author:** toast (polecat)
**Date:** 2026-02-08

## Overview

This document describes the architecture for analyzing incoming diplomatic messages
in Agents of Treachery (AoT). The system helps AI agents assess credibility, detect
deception, and formulate strategic responses to press messages during Diplomacy games.

## Problem Statement

During each diplomacy phase, agents receive messages from other powers containing
proposals, threats, information, and potential deception. Agents need structured
analysis of these messages to make informed diplomatic and strategic decisions.

Without analysis, agents would treat all messages at face value, making them
vulnerable to deception and unable to leverage trust history when evaluating proposals.

## Architecture

### Data Flow

```
Diplomacy Phase Start
    |
    v
Press Round 1: All agents send initial messages
    |
    v
analyzeMessagesForAllPowers()        <-- Sequential per-power to avoid TPM limits
    |
    +---> For each power:
    |       getInbox() → filter unanalyzed messages
    |       |
    |       v
    |     analyzeIncomingMessages()    <-- Batch: one LLM call per message
    |       |
    |       +---> buildAnalysisPrompt()   <-- Context: trust, history, relationship
    |       |       |
    |       |       v
    |       |     LLM call (temp=0.3, max 500 tokens)
    |       |       |
    |       |       v
    |       |     parseAnalysisResponse()  <-- Regex extraction with fallback defaults
    |       |       |
    |       |       v
    |       |     MessageAnalysis          <-- Structured output
    |       |
    |       +---> Accumulate in pendingMessageAnalyses
    |       +---> Record in diary via recordAnalysisInDiary()
    |       +---> Track IDs in analyzedMessageIds (dedup)
    |
    v
Press Round 2+: Agents with unread messages respond
    |
    v
analyzeMessagesForAllPowers() again   <-- Analyses accumulate across rounds
    |
    v
Agent turn prompt includes:
    generateAnalysisSummary(analyses)  <-- Formatted for LLM consumption
    |
    v
Movement Phase: Orders submitted
    |
    v
Promise reconciliation (compare messages to actual orders)
    |
    v
Phase reflection (detect betrayals, update trust)
```

### Core Components

#### 1. Message Analysis (`src/agent/negotiation.ts`)

**Purpose:** Per-message LLM analysis of incoming diplomatic press.

**Input:** A single `Message` + receiver's `AgentMemory` + recent conversation history.

**Output:** `MessageAnalysis` with structured fields:

| Field | Type | Description |
|-------|------|-------------|
| `senderIntent` | `SenderIntent` | Classified intent (alliance_proposal, threat, information, deception, request, commitment, neutral) |
| `credibilityScore` | `number` (0-1) | Sender credibility based on history |
| `strategicValue` | `StrategicValue` | High/medium/low strategic value |
| `recommendedResponse` | `RecommendedResponse` | Recommended action (accept, counter, reject, stall, investigate) |
| `reasoning` | `string` | LLM explanation (2-3 sentences) |
| `redFlags` | `string[]` | Deception indicators detected |
| `extractedCommitments` | `string[]` | Proposals/commitments extracted |

**Key functions:**

- `buildAnalysisPrompt()` - Constructs LLM prompt with:
  - Trust level and description (Hostile to Very High)
  - Relationship status (ally/enemy/neutral)
  - Active commitments count
  - Past broken promises and betrayals count
  - Recent conversation history (up to 10 messages)
  - Strategic notes about the sender
  - Deception indicator checklist

- `parseAnalysisResponse()` - Regex-based extraction with validation:
  - Each field extracted independently with fallback defaults
  - Intent validated against enum
  - Credibility clamped to [0, 1]
  - Strategic value and response validated against enums
  - Red flags and commitments split on commas

- `analyzeIncomingMessage()` - Single message analysis with LLM call:
  - Temperature 0.3 for consistency
  - Max 500 tokens
  - Falls back to `createFallbackAnalysis()` on error

- `analyzeIncomingMessages()` - Batch analysis with parallel Promise.all:
  - Filters to messages from other powers only
  - Uses last 10 messages as conversation context

- `generateAnalysisSummary()` - Formats analyses for agent prompt:
  - Credibility indicator (high/moderate/LOW CREDIBILITY - CAUTION)
  - Red flag warnings with emoji markers
  - One line per analysis

- `formatAnalysisForDiary()` / `recordAnalysisInDiary()` - Diary recording.

#### 2. Fallback Analysis

When LLM calls fail, the system creates a conservative fallback:
- Intent: `neutral`
- Credibility: derived from trust level (maps -1..1 to 0..1)
- Strategic value: `medium`
- Recommended response: `investigate`
- Red flags: includes "Low trust history" if trust < -0.3

This ensures the system never crashes due to LLM failures.

#### 3. Runtime Integration (`src/agent/runtime.ts`)

**`analyzeMessagesForAllPowers()`** orchestrates the analysis:
- Runs **sequentially** per power (not parallel) to avoid TPM rate limits
- Filters using `analyzedMessageIds` set to prevent re-analysis
- Appends to `pendingMessageAnalyses` map (accumulates across rounds)
- Records in diary and logs deception/low-credibility warnings

**Turn prompt integration:**
- During DIPLOMACY phase, `pendingMessageAnalyses` are formatted via
  `generateAnalysisSummary()` and injected into the agent's turn prompt
- Agents see one-line summaries with credibility indicators and red flags

**Cleanup:**
- `pendingMessageAnalyses` and `analyzedMessageIds` cleared between games
- Not cleared between phases within a game (analyses persist across rounds)

#### 4. Negotiation Metrics (`src/agent/negotiation-metrics.ts`)

**Purpose:** Game-wide tracking and scoring of negotiation quality.

**Class:** `NegotiationMetricsTracker`

**Tracked data:**
- Per-power message counts
- Per-sender analyses (accumulated)
- Promise records with reconciliations
- Alliance signals (cooperative/hostile/neutral per pair per turn)
- Interaction records (sender, receiver, analysis)

**Computed metrics:**
- `PromiseCorrelation` - Promise keep rate, weighted by confidence, broken down by type
- `AlliancePattern` - Alliance detection from cooperative signal runs (min 2 turns)
- `DeceptionMetrics` - Red flag rate, deceptive intent count, credibility averages, contradiction detection
- `PowerNegotiationScore` - Composite score (0-100) with weighted components:
  - Trustworthiness: 30%
  - Deception propensity: 20%
  - Alliance reliability: 20%
  - Diplomatic activity: 15%
  - Strategic effectiveness: 15%

**Contradiction detection:** Identifies same sender making alliance/commitment proposals
to different receivers in the same turn.

#### 5. Supporting Systems

**Promise Tracker (`src/analysis/promise-tracker.ts`):**
- Pattern-based extraction of promises from messages
- Reconciliation against actual orders
- Generates `PromiseMemoryUpdate` events with trust deltas

**Phase Reflection (`src/agent/reflection.ts`):**
- Post-resolution LLM analysis comparing promises to actions
- Generates trust updates and phase observations
- Classifications: cooperation, betrayal, neutral, surprise_attack, lie_of_omission

**Diary System (`src/agent/diary.ts`):**
- Two-layer memory: full permanent diary + consolidated yearly summaries
- Negotiation analyses recorded as `negotiation` type entries
- Context diary (summaries + current year) used in agent prompts

### Key Types

```typescript
// From src/agent/types.ts
type SenderIntent = 'alliance_proposal' | 'threat' | 'information' | 'deception'
                  | 'request' | 'commitment' | 'neutral';
type StrategicValue = 'high' | 'medium' | 'low';
type RecommendedResponse = 'accept' | 'counter' | 'reject' | 'stall' | 'investigate';

interface MessageAnalysis {
  messageId: string;
  sender: Power;
  receiver: Power;
  senderIntent: SenderIntent;
  credibilityScore: number;       // 0-1
  strategicValue: StrategicValue;
  recommendedResponse: RecommendedResponse;
  reasoning: string;
  redFlags: string[];
  extractedCommitments: string[];
  timestamp: Date;
}
```

## Design Decisions

### Sequential Analysis (not parallel)

Messages are analyzed sequentially per power to avoid TPM (tokens per minute)
rate limit crashes. Each analysis requires an LLM call; running all 7 powers
in parallel would burst API limits. Trade-off: slower but reliable.

### Accumulation Across Rounds

Analyses accumulate in `pendingMessageAnalyses` across press rounds rather than
being replaced. This gives agents growing context as the diplomacy phase progresses.
The `analyzedMessageIds` set prevents re-analyzing the same message.

### Conservative Fallbacks

Every parse operation has a safe default. Malformed LLM responses never crash the
system. The fallback analysis uses trust history as a simple credibility heuristic.

### Low Temperature (0.3)

Analysis uses temperature 0.3 for consistency. Diplomatic analysis should be
deterministic and reliable, not creative. The same message should produce similar
analyses across runs.

### Diary Recording

All analyses are recorded in the agent's diary, becoming part of the permanent
record. This enables:
- Long-term pattern detection
- Year-end consolidation that captures diplomatic trends
- Spectator access to "inside the mind" views

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No incoming messages | Empty array returned, no LLM calls |
| LLM call fails | Fallback analysis with conservative defaults |
| Malformed LLM response | Regex extraction with per-field defaults |
| Credibility out of range | Clamped to [0, 1] |
| Unknown intent | Falls back to `neutral` |
| Duplicate message analysis | `analyzedMessageIds` set prevents re-analysis |
| Rate limits | Sequential processing prevents burst |
| Self-messages | Filtered out (sender !== receiver) |

## Test Strategy

Tests should cover:

1. **Prompt construction** - Verify trust, relationship, and conversation context
   are correctly included in prompts
2. **Response parsing** - Well-formatted, red-flagged, and malformed responses
3. **Credibility clamping** - Values outside [0, 1] are clamped
4. **LLM integration** - Mock LLM returns expected analysis
5. **Fallback behavior** - LLM errors produce conservative defaults
6. **Diary formatting** - Analysis formatted correctly for diary entries
7. **Summary generation** - Credibility indicators and red flag warnings
8. **Metrics tracking** - Promise correlation, deception detection, contradictions
9. **Alliance pattern detection** - Cooperative signal runs, betrayal detection
10. **Power scoring** - Weighted composite calculation

Existing tests in `src/agent/__tests__/negotiation.test.ts` cover items 1-7.
Metrics tests should be added for items 8-10.

## File Map

| File | Purpose |
|------|---------|
| `src/agent/negotiation.ts` | Core message analysis (LLM-based) |
| `src/agent/negotiation-metrics.ts` | Game-wide metrics tracking |
| `src/agent/types.ts` | Type definitions (MessageAnalysis, etc.) |
| `src/agent/runtime.ts` | Orchestration (analyzeMessagesForAllPowers) |
| `src/agent/diary.ts` | Diary recording and consolidation |
| `src/agent/reflection.ts` | Post-phase reflection |
| `src/analysis/promise-tracker.ts` | Promise extraction and reconciliation |
| `src/agent/__tests__/negotiation.test.ts` | Unit tests |
