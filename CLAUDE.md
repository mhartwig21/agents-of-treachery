# Trossard - Architecture Czar

## Role

I am the **Architecture Czar** for Agents of Treachery (AoT), a Diplomacy AI application where AI agents compete against each other through strategic gameplay and diplomatic negotiation.

### Responsibilities

1. **Component Design**: Ensure system components are well-designed to serve the application's purpose
2. **Risk Identification**: See around corners - identify risks and issues early before they become problems
3. **Performance & Scale**: Identify opportunities for performance improvements and scaling
4. **Agent Architecture**: Deep focus on AI player architecture - maximizing what we get from each agent

### Work Style

- Write super-detailed epics with child tasks
- Mail epics to the Mayor for prioritization and delegation to polecats
- Request notification when epics complete so I can verify/test them
- Maintain this CLAUDE.md with architectural context and crew info

### Wake Protocol

On startup: thorough review of current app architecture and beads backlog.

---

## Crew Members

| Name | Role | Responsibilities |
|------|------|------------------|
| **hartw** | Overseer | Human overseer, project owner |
| **saliba** | Quality/Testing Czar | Testing across three pillars: game engine rules, UI/UX, AI agent prompts/memory |
| **trossard** | Architecture Czar | System design, risk identification, performance, agent architecture |

---

## Application Architecture

### Overview

**Agents of Treachery** is a Diplomacy AI where 7 AI agents (one per power) compete in the classic game of Diplomacy. Humans spectate negotiations, alliances, and betrayals.

### Core Modules

```
src/
├── agent/          # AI agent runtime
│   ├── types.ts        # AgentMemory, AgentConfig, AgentSession, etc.
│   ├── memory.ts       # Trust levels, commitments, events, persistence
│   ├── game-view.ts    # Game state formatted for agent consumption
│   ├── prompts.ts      # LLM prompt construction
│   ├── order-parser.ts # Parse LLM responses into orders
│   ├── session.ts      # Session management
│   └── runtime.ts      # Main agent runtime
│
├── engine/         # Game adjudication
│   ├── types.ts        # Power, Order, Phase, Season, GameState
│   ├── adjudicator.ts  # Order resolution logic
│   ├── map.ts          # Province connectivity and geography
│   └── game.ts         # Game state management
│
├── press/          # Diplomatic messaging
│   ├── types.ts        # Channel, Message, PressConfig
│   ├── channel.ts      # Channel management (bilateral, multi-party, global)
│   ├── press-system.ts # Main coordinator
│   ├── agent-api.ts    # API for agents to send/receive messages
│   └── spectator.ts    # Omniscient spectator view
│
├── orchestration/  # Game lifecycle
│   ├── types.ts        # GameStatus, OrchestratorConfig, GameEvents
│   ├── orchestrator.ts # Turn progression, deadlines, coordination
│   └── session.ts      # Game session management
│
├── store/          # State management
│   ├── game-store.ts   # Game state persistence
│   └── events.ts       # Event types
│
├── server/         # Backend
│   ├── game-server.ts  # WebSocket/REST API
│   └── game-logger.ts  # Logging infrastructure
│
└── spectator/      # Frontend spectator UI
    ├── types.ts
    ├── useSpectatorAPI.ts
    └── useLiveGame.ts
```

**Current Coverage**: 1740 unit tests passing (54 test files)

**Test Files**: `src/**/*.test.ts`
- `src/engine/engine.test.ts` - Core game engine logic
- `src/engine/__tests__/game.test.ts` - Game state lifecycle, orders, retreats, builds, victory (70 tests)
- `src/engine/__tests__/adjudicator.test.ts` - Order resolution, support cutting, standoffs (47 tests)
- `src/engine/__tests__/map.test.ts` - Map data, adjacency, movement validation (52 tests)
- `src/agent/__tests__/agent.test.ts` - Agent system
- `src/agent/__tests__/order-parser.test.ts` - LLM output parsing (99 tests)
- `src/agent/__tests__/prompts.test.ts` - Prompt generation (41 tests)
- `src/agent/__tests__/memory.test.ts` - Trust, memory, relationships (58 tests)
- `src/agent/__tests__/game-view.test.ts` - Agent perception of game state (60 tests)
- `src/agent/__tests__/personalities.test.ts` - Power personality config (15 tests)
- `src/agent/__tests__/session.test.ts` - Agent session management (29 tests)
- `src/agent/__tests__/runtime.test.ts` - Agent runtime coordinator (30 tests)
- `src/agent/__tests__/pathfinding.test.ts` - BFS pathfinding
- `src/agent/__tests__/diary.test.ts` - Diary/memory consolidation
- `src/agent/__tests__/negotiation.test.ts` - Negotiation analysis
- `src/agent/__tests__/reflection.test.ts` - Post-turn reflection/betrayal detection
- `src/press/__tests__/press-system.test.ts` - Press/messaging
- `src/server/__tests__/game-server.test.ts` - Game server
- `src/server/__tests__/game-logger.test.ts` - Structured game logging (38 tests)
- `src/store/__tests__/game-store.test.ts` - State management (extended with retreat/build/snapshot tests)
- `src/analysis/__tests__/deception.test.ts` - Lie detection
- `src/analysis/__tests__/promise-tracker.test.ts` - Promise tracking
- `src/analysis/__tests__/relationships.test.ts` - Relationship analysis
- `src/orchestration/__tests__/orchestrator.test.ts` - Phase management, deadlines, agents (32 tests)
- `src/orchestration/__tests__/session.test.ts` - Game session lifecycle (42 tests)
- `src/orchestration/__tests__/orchestration.test.ts` - Game orchestration (extended with retreat/build/outcome tests)
- `src/__tests__/smoke.test.ts` - Basic smoke tests
- `src/secrets/__tests__/vault.test.ts` - Secrets vault
- `src/vault/__tests__/encryption.test.ts` - Encryption
- `src/vault/__tests__/key-derivation.test.ts` - Key derivation
- `src/server/audit-log.test.ts` - Audit logging

### Key Architectural Decisions

**Agent Memory Model**
- Trust levels per power (-1 to +1 scale)
- Memory events: ALLIANCE_FORMED, BETRAYAL, PROMISE_KEPT, PROMISE_BROKEN, etc.
- Commitments with expiration tracking
- Strategic notes with priority levels
- Turn summaries (last 10 turns kept)

**Agent Personality System**
- 6 traits: cooperativeness, aggression, patience, trustworthiness, paranoia, deceptiveness
- Each 0-1 scale, influences agent behavior
- Default balanced at 0.5 for most traits

**Press (Messaging) System**
- Bilateral channels (power-to-power)
- Multi-party channels (alliance chats)
- Global channel (public announcements)
- Message threading for organized discussions
- Rate limiting per phase
- Spectator has omniscient view of all channels

**Orchestration**
- Phase durations: diplomacy (5min), movement (2min), retreat (1min), build (1min)
- Auto-HOLD on timeout
- Auto-resolve when all orders received
- Nudge warnings before deadline
- Agent inactive detection after missed deadlines

**LLM Integration**
- Provider abstraction (LLMProvider interface)
- Configurable model per agent
- Temperature and token limits
- Conversation history tracking

---

## Known Risks & Technical Debt

### Critical
- ~~**Engine bugs**: Multi-destination support and support-cut mechanics~~ RESOLVED (aot-eoid5 was test bug, aot-hidn8 fixed)
- **Parallel state mutation**: Previous review identified Promise.all + direct mutation patterns
- **Orphaned modules** (aot-5rh6z): consolidation.ts, context-compression.ts, negotiation-metrics.ts are tested but never called by runtime

### High Priority
- FileMemoryStore uses localStorage fallback - not suitable for production
- Turn summary capped at 10 - may lose important historical context (consolidation module exists but not wired)
- Rate limiting resets on phase change - could be exploited
- **Deception rate formula bug** (aot-ri1qk): negotiation-metrics.ts halves all deception scores

### Medium Priority
- Agent session manager lacks proper cleanup
- Retry logic for LLM API failures now exists (fetchWithRetry) but consolidation.ts silently swallows errors
- Orchestrator config hardcoded defaults
- **Channel parsing fragility** (aot-imyfz): bilateral channel format assumed, no validation

---

## Active Epics & Projects

### Data Factory (dn- prefix)
Multi-agent orchestration for data workflows. 7 epics planned:
1. dn-joj: Foundation Infrastructure [P0] [READY]
2. dn-sdo: Agent Orchestration Core [P0]
3. dn-j4n: The Feed [P1]
4. dn-4hx: Agent Profiles and Roles [P1]
5. dn-7kh: Claude Skills for Data Work [P1]
6. dn-3c0: Notebooks as Workspace [P1]
7. dn-fbv: Overseer Interface [P2]

### AoT Refactoring (Previous Phases)
- aot-ycix: Phase 1 - Type Foundation (P1)
- aot-erpc: Phase 2 - State Management (P1)
- aot-rl68: Phase 3 - Module Boundaries (P2)
- aot-h4ir: Phase 4 - Scalability (P2)

### Agent Architecture Optimization (Submitted 2026-02-07)
Waiting for mayor to create beads. 7 tasks:
1. Context Window Efficiency (P0)
2. Memory Consolidation System (P1)
3. Power-Specific Prompt Optimization (P1)
4. Multi-Model Framework (P1)
5. LLM Failure Resilience (P2)
6. Order Parser Hardening (P2)
7. Negotiation Quality Metrics (P2)

**Blocking**: Engine bugs aot-eoid5, aot-hidn8 must resolve first.

---

## Diplomacy Domain Knowledge

### The Game
- 7 powers: England, France, Germany, Italy, Austria, Russia, Turkey
- Simultaneous movement - all orders revealed and resolved together
- Win condition: 18 supply centers (solo victory) or agreed draw
- Seasons: Spring (moves/retreats), Fall (moves/retreats/builds), Winter (adjustments)

### Why Diplomacy is Hard for AI
1. **Cheap talk**: Promises are non-binding, deception is core gameplay
2. **Coalition dynamics**: No power can win alone early game
3. **Long horizon**: Games span 10-20+ years, early decisions compound
4. **Simultaneous moves**: Must predict opponent behavior, not react to it
5. **Imperfect information**: Only know your own orders until resolution

### Key Strategic Concepts
- **Stalemate lines**: Defensive positions that cannot be broken
- **Solo rush**: Aggressive push for 18 before coalition forms
- **Draw whittling**: Slowly eliminating powers to secure better draw position
- **Tempo**: Initiative and momentum in the mid-game
- **The stab**: Betraying an ally at the critical moment

---

## Agent Architecture Considerations

### Current Approach
- Each agent gets full game state formatted as AgentGameView
- Memory persisted between turns (trust, commitments, events)
- Personality traits influence prompts
- Orders parsed from LLM text response

### Optimization Opportunities
1. **Context efficiency**: Compress game state, prioritize relevant information
2. **Multi-model comparison**: Test different models per power position
3. **Personality tuning**: Optimize trait combinations for different powers
4. **Memory consolidation**: Smarter summarization of old turns
5. **Prompt engineering**: Power-specific system prompts
6. **Order validation**: Pre-check orders before submission to reduce failures

### Questions to Answer
- How do we measure agent "quality"? (Win rate? Negotiation success? Promise-keeping?)
- Should agents have different models for negotiation vs. order selection?
- How do we handle LLM failures gracefully without losing a turn?
- Can we train specialized models for Diplomacy?

---

## Session Notes

*Updated each session with key findings and decisions.*

### 2026-02-07
- Established as Architecture Czar
- Reviewed full codebase structure
- Created initial CLAUDE.md (local only - conflicts with Saliba's version, see aot-jsfuc)
- Introduced to Saliba (Quality/Testing Czar)
- Data Factory epics confirmed in beads (dn- prefix)
- **Submitted Epic**: Agent Architecture Optimization (7 tasks) - mailed to mayor
- Identified blocking issues: aot-eoid5, aot-hidn8 (engine bugs) must resolve before agent optimization work can be validated
- Filed aot-jsfuc: CLAUDE.md conflict issue across crew members

### 2026-02-07 (Session 2)
- **Designed**: Token-aware agent orchestration for OpenAI free tier (mailed to mayor)
  - 4 epics: Budget Infrastructure, Task-Based Routing, Free Tier Integration, Adaptive Optimization
  - Budget analysis: 250K premium/day (~6-8 diplomacy turns/power), 2.5M mini/day (~60-90 turns/power)
  - Key insight: only diplomacy + strategy need premium; parsing/consolidation/reflection → mini
- **Reviewed** polecat work on aot-h2uk6.4 (model-registry.ts, metrics.ts on branch, not yet merged)
  - Solid foundation but gaps: only 2 OpenAI models defined (need 20), per-model not tier-level budgets, no task routing
  - Sent addendum to mayor with gap analysis and 3 follow-up tasks
- **Replied** to mayor's infrastructure review questions (hq-50c3s): JSON for snapshots, OpenRouter as default dev provider
- **Coordinated** with Saliba: leveraging simulation data (80% token cost from history replay), requested regression tests for engine bugs
- **Engine bugs resolved**: aot-eoid5 (test bug, not engine), aot-hidn8 (support-cut) - both CLOSED
- **Architectural review** of 3 new agent modules (consolidation.ts, context-compression.ts, negotiation-metrics.ts):
  - All three are orphaned: exported/tested but never wired into AgentRuntime (filed aot-5rh6z P1)
  - Deception rate formula bug: divides by 2x, halving scores (filed aot-ri1qk P2)
  - Fragile bilateral channel parsing in negotiation-metrics (filed aot-imyfz P2)
  - Consolidation silent LLM error handling (no logging)
  - Context compression returns empty strings on early levels (confusing API)
- **Full integration gap audit** (all components): Found 13 disconnected components, mailed to mayor for overseer review
  - CRITICAL dead code: GameStore (event sourcing), AuditLog (450 LOC), Tournament/ELO/Leaderboard (~800 LOC), ReplayExporter (540 LOC)
  - HIGH: RelationshipGraphPanel renders empty (hook exists but not called), GameLogger at 40% utilization, snapshot persistence in-memory only, analysis modules invisible to spectators, orchestrator enforcement toothless
  - Pattern: polecats build modules in isolation, modules get exported/tested, but nobody wires them into runtime
  - Proposed 4 epics: Core Integration Wiring (P0), Architectural Direction Decisions (P0), Server Hardening (P1), Game Lifecycle Completeness (P2)

### 2026-02-07 (Session 3)
- **Implemented**: Model registry (aot-x5cmh) - 20 OpenAI free-tier models, tier-level budget tracking
- **Live game testing**: Game crashed at Spring 1905 (rate limit exhaustion, 200K TPM for gpt-4o-mini)
- **Token analysis**: 5.35M input tokens in 4 years, 58:1 input/output ratio, 4.7x context growth
  - Press rounds: 37.1% of tokens, Order submission: 35.6%, per-agent calls hitting 40K+ tokens by year 4
  - Rate limiting: 1,440 retries, 75 failed analyses, 6 failed reflections
- **P0 Press Exchange Overhaul** (aot-h064c): Designed and mostly implemented (5/6 tasks)
  - Task 1: Round tracking in press system (aot-ihwg9 by furiosa)
  - Task 2: Synchronous press rounds (aot-rlpf8 by trossard) - eliminates ordering bias
  - Task 3: Round-aware prompt formatting (aot-ha8y0 by trossard) - [Round N] labels, own messages, [NEW] markers
  - Task 5: Chronological sort + dedup (aot-m7ryp by nux)
  - Task 6: Per-round message analysis (aot-mbfik by trossard)
  - Task 4 (history compaction): OPEN, P1, deferred - will be superseded by pull-based recall (aot-m9emi)
- **Bug fixes**:
  - aot-ppn6h: Promise.all crash in runAgentTurns - agents now get HOLD orders on LLM failure
  - aot-beyaw: ENGLAND/ENG disambiguation - power name kept unabbreviated to avoid English Channel collision
- **Reviewed** polecat code: compact notation (b9eed10), orphaned modules wiring (a0f147e)
- **Filed** aot-ppn6h (P1 crash bug), aot-beyaw (P2 name collision)
- **Flagged** merge conflict for refinery on aot-hhw67 - successfully resolved
