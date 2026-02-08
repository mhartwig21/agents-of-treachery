# Agents of Treachery (AoT) - Shared CLAUDE.md

**Diplomacy AI** where 7 AI agents compete in the classic board game. Humans spectate negotiations, alliances, and betrayals.

---

## Crew Members

| Name | Role | Responsibilities |
|------|------|------------------|
| **hartw** | Overseer | Human overseer, project owner. Has .env with API keys. |
| **saliba** | Quality/Testing Czar | Testing across three pillars: game engine rules, UI/UX, AI agent prompts/memory |
| **trossard** | Architecture Czar | System design, risk identification, performance, agent architecture |

---

## Application Architecture

### Core Modules

```
src/
├── agent/          # AI agent runtime
│   ├── types.ts        # AgentMemory, AgentConfig, AgentSession
│   ├── memory.ts       # Trust levels, commitments, events, persistence
│   ├── game-view.ts    # Game state formatted for agent consumption
│   ├── prompts.ts      # LLM prompt construction
│   ├── order-parser.ts # Parse LLM responses into orders
│   ├── session.ts      # Session management
│   ├── runtime.ts      # Main agent runtime
│   ├── diary.ts        # Long-term memory consolidation
│   ├── reflection.ts   # Post-turn analysis
│   ├── negotiation.ts  # Negotiation analysis
│   ├── personalities.ts # Power personality traits
│   ├── pathfinding.ts  # BFS pathfinding for strategic context
│   ├── consolidation.ts # Memory consolidation
│   ├── context-compression.ts # Context window compression
│   ├── negotiation-metrics.ts # Negotiation quality metrics
│   ├── model-registry.ts # Multi-model framework (20 OpenAI models)
│   └── prompt-loader.ts # Prompt template loading
│
├── engine/         # Game adjudication
│   ├── types.ts        # Power, Order, Phase, Season, GameState
│   ├── adjudicator.ts  # Order resolution logic
│   ├── map.ts          # Province connectivity and geography
│   └── game.ts         # Game state management
│
├── press/          # Diplomatic messaging
│   ├── types.ts        # Channel, Message, PressConfig
│   ├── channel.ts      # Channel management
│   ├── press-system.ts # Main coordinator
│   ├── agent-api.ts    # API for agents
│   └── spectator.ts    # Omniscient spectator view
│
├── orchestration/  # Game lifecycle
│   ├── orchestrator.ts # Turn progression, deadlines
│   └── session.ts      # Game session management
│
├── analysis/       # Game analysis
│   ├── deception.ts    # Lie detection
│   ├── promise-tracker.ts # Promise tracking
│   ├── relationships.ts # Relationship analysis
│   └── narrative.ts    # Game narrative generation
│
├── store/          # State management
│   ├── game-store.ts   # Game state persistence
│   ├── snapshot-manager.ts # Snapshot management
│   ├── auto-snapshot.ts # Auto-snapshot system
│   ├── replay-exporter.ts # Game replay export
│   └── events.ts       # Event types
│
├── server/         # Backend
│   ├── game-server.ts  # WebSocket/REST API
│   ├── game-logger.ts  # Structured logging
│   ├── providers.ts    # LLM provider abstraction
│   └── audit-log.ts    # Audit logging
│
├── commentary/     # AI commentary system
│   └── types.ts        # Commentary types
│
├── audio/          # Game sounds
│   └── useGameSounds.ts # Sound effects hook
│
├── tournament/     # Tournament system
│   ├── tournament.ts   # Tournament management
│   ├── elo.ts          # ELO rating system
│   └── leaderboard.ts  # Leaderboard tracking
│
├── experiment/     # Experiment framework
│   └── runner.ts       # Experiment runner
│
├── hooks/          # React hooks
│   ├── useResolutionAnimation.ts # Turn resolution animation
│   ├── useRelationshipHistory.ts # Relationship history
│   └── useActionRelationships.ts # Action-based relationships
│
├── components/     # React UI components
│   ├── DiplomacyMap.tsx # Main map component
│   ├── map/            # Map sub-components
│   │   ├── AnimatedUnit.tsx # Unit display with animation
│   │   ├── OrderArrow.tsx   # Order visualization
│   │   ├── ConflictMarker.tsx # Battle visualization
│   │   └── ResolutionOverlay.tsx # Failed order markers
│   ├── spectator/      # Spectator UI
│   │   ├── SpectatorDashboard.tsx # Game selection
│   │   ├── SpectatorGameView.tsx  # Game view layout
│   │   ├── RelationshipGraphPanel.tsx # Relationship graph
│   │   ├── RelationshipHistoryModal.tsx # History modal
│   │   ├── RelationshipSparkline.tsx # Mini chart
│   │   ├── SupplyCenterBalanceChart.tsx # SC chart
│   │   ├── PressMessageModal.tsx # Message detail modal
│   │   ├── PressTimeline.tsx # Message timeline
│   │   ├── ChannelPanel.tsx  # Channel management
│   │   ├── MessageCard.tsx   # Message display
│   │   ├── CommentaryPanel.tsx # AI commentary
│   │   ├── LiveActivityPanel.tsx # Real-time activity
│   │   ├── PowerStatsPanel.tsx # Power statistics
│   │   ├── TurnResolutionPlayer.tsx # Resolution animation
│   │   ├── TurnScrubber.tsx  # Timeline scrubber
│   │   ├── GameEventOverlay.tsx # Event overlays
│   │   ├── BetrayalHighlight.tsx # Betrayal visualization
│   │   └── OrdersPanel.tsx   # Orders display
│   └── shared/         # Shared components
│       ├── CollapsiblePanel.tsx
│       ├── PhaseIndicator.tsx
│       └── PowerBadge.tsx
│
└── spectator/      # Spectator hooks
    ├── types.ts
    ├── useSpectatorAPI.ts
    └── useLiveGame.ts
```

---

## Testing Infrastructure

### Unit Testing - Vitest

```bash
npm run test              # Run all unit tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

**Current Coverage**: 2101 unit tests passing, 2 skipped (65 test files, 62 passing, 3 failing due to import errors)

**Failing suites** (broken imports, not test failures):
- `src/experiment/__tests__/experiment.test.ts` - Missing `dotenv/config` import
- `src/vault/__tests__/encryption.test.ts` - Missing `@noble/hashes/argon2.js` import
- `src/vault/__tests__/key-derivation.test.ts` - Missing `@noble/hashes/argon2.js` import

**Test Files** (62 passing suites):

| Area | File | Tests |
|------|------|-------|
| **Engine** | `src/engine/engine.test.ts` | 131 |
| | `src/engine/__tests__/game.test.ts` | 70 |
| | `src/engine/__tests__/adjudicator.test.ts` | 61 |
| | `src/engine/__tests__/map.test.ts` | 52 |
| **Agent** | `src/agent/__tests__/order-parser.test.ts` | 256 |
| | `src/agent/__tests__/agent.test.ts` | 84 |
| | `src/agent/__tests__/game-view.test.ts` | 60 |
| | `src/agent/__tests__/consolidation.test.ts` | 60 |
| | `src/agent/__tests__/memory.test.ts` | 58 |
| | `src/agent/__tests__/pathfinding.test.ts` | 58 |
| | `src/agent/__tests__/model-registry.test.ts` | 53 |
| | `src/agent/__tests__/negotiation-metrics.test.ts` | 48 |
| | `src/agent/__tests__/personality-behaviors.test.ts` | 47 |
| | `src/agent/__tests__/context-compression.test.ts` | 43 |
| | `src/agent/__tests__/prompts.test.ts` | 41 |
| | `src/agent/__tests__/diary.test.ts` | 40 |
| | `src/agent/__tests__/runtime.test.ts` | 36 |
| | `src/agent/__tests__/session.test.ts` | 29 |
| | `src/agent/__tests__/memory-persistence.test.ts` | 20 |
| | `src/agent/__tests__/prompt-loader.test.ts` | 18 |
| | `src/agent/__tests__/agent-win-condition.test.ts` | 17 |
| | `src/agent/__tests__/reflection.test.ts` | 16 |
| | `src/agent/__tests__/personalities.test.ts` | 15 |
| | `src/agent/__tests__/negotiation.test.ts` | 12 |
| **Analysis** | `src/analysis/__tests__/narrative.test.ts` | 25 |
| | `src/analysis/__tests__/promise-tracker.test.ts` | 22 |
| | `src/analysis/__tests__/relationships.test.ts` | 22 |
| | `src/analysis/__tests__/deception.test.ts` | 14 |
| **Components** | `src/components/spectator/__tests__/TurnResolutionPlayer.test.tsx` | 50 |
| | `src/components/__tests__/DiplomacyMap.orderDisplay.test.tsx` | 30 |
| | `src/components/map/__tests__/OrderArrow.test.tsx` | 24 |
| | `src/components/spectator/__tests__/OrdersPanel.test.tsx` | 20 |
| | `src/components/spectator/__tests__/RelationshipHistoryModal.test.tsx` | 12 |
| | `src/components/shared/__tests__/PowerBadge.test.tsx` | 11 |
| | `src/components/spectator/__tests__/RelationshipSparkline.test.tsx` | 11 |
| | `src/components/spectator/__tests__/RelationshipGraphPanel.test.tsx` | 10 |
| | `src/components/map/__tests__/ConflictMarker.test.tsx` | 9 |
| | `src/components/map/__tests__/AnimatedUnit.test.tsx` | 8 |
| **Hooks** | `src/hooks/__tests__/useResolutionAnimation.test.ts` | 20 |
| | `src/hooks/__tests__/useActionRelationships.test.ts` | 12 |
| | `src/hooks/__tests__/useRelationshipHistory.test.ts` | 8 |
| **Orchestration** | `src/orchestration/__tests__/session.test.ts` | 42 |
| | `src/orchestration/__tests__/orchestration.test.ts` | 35 |
| | `src/orchestration/__tests__/orchestrator.test.ts` | 32 |
| **Press** | `src/press/__tests__/press-system.test.ts` | 43 |
| **Server** | `src/server/__tests__/game-logger.test.ts` | 39 |
| | `src/server/__tests__/providers.test.ts` | 27 |
| | `src/server/audit-log.test.ts` | 22 |
| | `src/server/__tests__/game-server.test.ts` | 3 |
| **Store** | `src/store/__tests__/game-store.test.ts` | 34 |
| | `src/store/__tests__/snapshot-manager.test.ts` | 28 |
| | `src/store/__tests__/replay-exporter.test.ts` | 20 |
| | `src/store/__tests__/auto-snapshot.test.ts` | 11 |
| | `src/store/__tests__/events.test.ts` | 4 |
| **Tournament** | `src/tournament/__tests__/elo.test.ts` | 24 |
| | `src/tournament/__tests__/tournament.test.ts` | 21 |
| | `src/tournament/__tests__/leaderboard.test.ts` | 12 |
| **Commentary** | `src/commentary/__tests__/commentary.test.ts` | 19 |
| **Data** | `src/data/__tests__/territories.test.ts` | 13 |
| **Audio** | `src/audio/__tests__/useGameSounds.test.ts` | 5 |
| **Secrets** | `src/secrets/__tests__/vault.test.ts` | 33 |
| **Smoke** | `src/__tests__/smoke.test.ts` | 3 |

### E2E Testing - Playwright

```bash
npm run test:e2e          # All E2E tests (chromium project, 198 tests)
npm run test:e2e:ui       # Interactive UI mode
npm run test:e2e:smoke    # Quick smoke tests (no server needed)
npm run test:e2e:live     # Full stack with game server + AI
npm run test:e2e:live:ui  # Live tests in UI mode
npm run test:e2e:sim      # Game simulation tests (requires server)
npm run test:e2e:sim:ui   # Simulation tests in UI mode
```

**Total**: 219 E2E tests across 13 files (4 Playwright projects)

| Project | Tests | Description |
|---------|-------|-------------|
| chromium | 198 | Standard browser tests |
| simulation | 13 | Game simulation (needs server) |
| live | 6 | Full stack + AI agents |
| smoke | 2 | Quick sanity checks |

**E2E Test Files**:

| File | Tests | Description |
|------|-------|-------------|
| `e2e/exploratory-crawl-2.spec.ts` | 30 | Crawl round 2: press, mobile, browser nav, units |
| `e2e/exploratory-crawl.spec.ts` | 28 | Crawl round 1: buttons, panels, territories, stress |
| `e2e/exploratory-crawl-3.spec.ts` | 26 | Crawl round 3: modals, ARIA, filters, animations |
| `e2e/ui-interactions.spec.ts` | 24 | Targeted: button clicks, chart hover, pointer events |
| `e2e/map-elements.spec.ts` | 18 | Map: territories, units, supply centers |
| `e2e/accessibility.spec.ts` | 18 | Keyboard nav, focus, semantic HTML, contrast |
| `e2e/resolution-animation.spec.ts` | 16 | Turn resolution animation |
| `e2e/navigation.spec.ts` | 15 | Map interactions, panels, phase indicator |
| `e2e/dashboard.spec.ts` | 13 | Dashboard filtering, search, view modes |
| `e2e/game-simulation.spec.ts` | 13 | Comprehensive game simulation (simulation project) |
| `e2e/app.spec.ts` | 8 | Spectator dashboard, player mode, game view |
| `e2e/live.spec.ts` | 6 | Full stack with real AI agents (live project) |
| `e2e/smoke.spec.ts` | 2 | Basic app smoke tests |

**E2E Test Utils**: `e2e/test-utils.ts`
- `screenshot()` - Capture screenshots with timestamps
- `captureTimelapse()` - Series of screenshots at intervals
- `createWebSocketMonitor()` - Monitor game server messages
- `navigateToGame()` - Navigate to a specific game
- `isMapVisible()` - Check if map SVG is rendered
- `getCurrentPhase()` - Get current game phase text
- `monitorGameWithScreenshots()` - Monitor game and capture phase changes

**Latest E2E results** (2026-02-07): 197 passed, 1 failed (known)
- FAIL: `navigation.spec.ts:124` - "can click on territory" (recharts overlay intercepts pointer events on map SVG paths)

### Game Simulation Scripts

```bash
npx tsx scripts/run-game.ts --openai --model gpt-4o --years 25 --output results.json
npx tsx scripts/run-game.ts --mock --turns 10
npx tsx scripts/run-experiment.ts --config experiments/openai-25year-config.json
npx tsx scripts/test-models.ts --all
npx tsx scripts/test-ollama-models.ts    # Test all local Ollama models
npx tsx scripts/observe-game.ts          # Observe running game
npx tsx scripts/analyze-game.ts          # Post-game analysis
npx tsx scripts/generate-narrative.ts    # Generate game narrative
```

### Game Server Scripts

```bash
npm run server              # Default server
npm run server:mock         # Mock LLM (fast, deterministic)
npm run server:openai       # OpenAI (requires OPENAI_API_KEY)
npm run server:claude       # Anthropic (requires ANTHROPIC_API_KEY)
npm run server:ollama       # Ollama default model
npm run server:mistral      # mistral via Ollama
npm run server:qwen         # qwen2.5:7b via Ollama
npm run server:deepseek     # deepseek-r1:8b via Ollama
npm run server:gemma        # gemma2:9b via Ollama
npm run server:phi          # phi3:mini via Ollama
npm run server:llama        # llama3.2 via Ollama
npm run server:llama-small  # llama3.2:1b via Ollama
npm run server:openrouter           # OpenRouter default
npm run server:openrouter:claude    # Claude 3.5 Sonnet via OpenRouter
npm run server:openrouter:gpt4     # GPT-4o via OpenRouter
npm run server:openrouter:llama    # Llama 3.1 70B via OpenRouter
```

### Experiment Configs

```
experiments/
├── mock-3year-test.json         # Quick mock test config
└── openai-25year-config.json    # Full OpenAI game config
```

---

## Known UI Bugs (Catalogued)

27 bugs found across 3 exploratory crawl rounds + targeted testing:

### From Targeted UI Testing (B1-B8)
- **B1**: No error message when WebSocket connection fails
- **B2**: `startLiveGame()` silently drops messages when WS not open
- **B3**: Blind 1000ms timeout on game creation
- **B4**: No toast/notification for game creation result
- **B5**: Edge opacity transition too dramatic (0.15↔0.8 on 21 edges)
- **B6**: Tooltip position misaligned with responsive SVG viewBox
- **B7**: No hover debounce on relationship nodes
- **B8**: recharts `pointer-events: none` not applied to rendered SVG paths

### From Exploratory Crawl Round 1 (B9-B13)
- **B9**: 10/21 relationship edge tooltips clip outside viewport (y as low as -70px)
- **B10**: Game cards not keyboard-focusable (Tab skips them, WCAG)
- **B11**: Horizontal overflow at 320px viewport
- **B12**: Map territories have no hover tooltips (0/64 positions)
- **B13**: Turn scrubber buttons disabled with no explanation

### From Exploratory Crawl Round 2 (B14-B20)
- **B14**: SVG map overlay intercepts mobile tab buttons at 375px viewport
- **B15**: Browser back button doesn't return to dashboard
- **B16**: No tooltips on map unit hover (0/10 markers)
- **B17**: Order arrows not rendered despite orders existing
- **B18**: Mobile tab active state not applied for Orders/Press/Graph
- **B19**: Page refresh loses game view state
- **B20**: 2 infinite CSS animations (connection status pulse)

### From Exploratory Crawl Round 3 (B21-B27)
- **B21**: 7 buttons without accessible names (WCAG)
- **B22**: 28 interactive SVG elements lack ARIA roles (WCAG)
- **B23**: Heading hierarchy skip h1→h3 (WCAG)
- **B24**: Power filter buttons have no active state styling
- **B25**: Channel type filter tabs only show "All" (Bilateral/Multiparty/Global missing)
- **B26**: Speed buttons (0.5x/1x/2x/4x) have no active state
- **B27**: Focus order jumps backward 3 times (WCAG)

---

## Diplomacy Rules Quick Reference

- **7 Powers**: England, France, Germany, Italy, Austria, Russia, Turkey
- **34 Supply Centers** total; **18 to win** (solo victory)
- **Seasons**: Spring (DIPLOMACY -> MOVEMENT -> RETREAT), Fall (same), Winter (BUILD)
- **Units**: Army (land), Fleet (sea/coast). 1:1 with supply centers.
- **Orders**: HOLD, MOVE (->), SUPPORT, CONVOY
- **Combat**: Attack strength must EXCEED defense. Equal = standoff.
- **Support cut**: Supporting unit attacked = support cut (but not if attacked by the unit it's supporting)
- **Convoy**: Fleet in sea province transports army across water
- **Retreat**: Dislodged unit retreats to adjacent empty province (not attacker's origin)
- **Build**: Winter only, in unoccupied home SCs you control

---

## Key Architectural Decisions

**Agent Memory Model**
- Trust levels per power (-1 to +1 scale)
- Memory events: ALLIANCE_FORMED, BETRAYAL, PROMISE_KEPT, PROMISE_BROKEN, etc.
- Commitments with expiration tracking
- Strategic notes with priority levels
- Turn summaries (last 10 turns kept)

**Agent Personality System**
- 6 traits: cooperativeness, aggression, patience, trustworthiness, paranoia, deceptiveness
- Each 0-1 scale, influences agent behavior

**Press (Messaging) System**
- Bilateral, multi-party, and global channels
- Message threading, rate limiting per phase
- Spectator has omniscient view

**Orchestration**
- Phase durations: diplomacy (5min), movement (2min), retreat (1min), build (1min)
- Auto-HOLD on timeout, auto-resolve when all orders received

**LLM Integration**
- Provider abstraction (LLMProvider interface)
- Model registry with 20 OpenAI free-tier models
- Configurable model per agent, temperature and token limits

---

## Known Risks & Technical Debt

### Critical
- **Parallel state mutation**: Promise.all + direct mutation patterns (partially mitigated)
- **Diary content gap**: Negotiation diary entries record metadata but NOT message content

### High Priority
- FileMemoryStore uses localStorage fallback
- Turn summary capped at 10
- **Deception rate formula bug** (aot-ri1qk): halves all deception scores

### Medium Priority
- Agent session manager lacks proper cleanup
- Consolidation.ts silently swallows LLM errors
- **Channel parsing fragility** (aot-imyfz): no validation on bilateral format

---

## Available Ollama Models

| Model | Size | VRAM | Quality | Speed |
|-------|------|------|---------|-------|
| llama3.2:1b | 1.3GB | ~1.6GB | Low (83% parse errors) | Fast (~7s) |
| mistral:7b | 4.4GB | ~4.9GB | Medium (38% parse errors) | Medium (~11s) |
| qwen2.5:7b | 4.7GB | ~4.7GB | Medium (44% parse errors) | Medium (~11s) |

**GPU**: RTX 2060 (6GB VRAM) - all 7b models fit comfortably

---

## Quality Checklist

Before any PR/commit is considered complete:
- [ ] Types pass (`npm run typecheck`)
- [ ] Unit tests pass (`npm run test`)
- [ ] E2E smoke tests pass (`npm run test:e2e:smoke`)
- [ ] No obvious bugs in manual testing
- [ ] Error cases handled

---

## Active Work Tracking

```bash
bd list                    # All beads
bd list --status=in_progress  # In-progress work
bd show <bead-id>          # Bead details
bd close <bead-id>         # Mark complete
bd sync                    # Sync with remote
```
