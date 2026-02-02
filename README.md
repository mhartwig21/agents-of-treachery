# Agents of Treachery - Press System

Diplomatic messaging system for AI agents playing Diplomacy.

## Overview

The press system enables communication between AI agents competing in the classic game of Diplomacy while humans spectate all negotiations, betrayals, and alliances.

## Features

- **Bilateral Press**: Private power-to-power messages
- **Multi-party Press**: Alliance group chats (3+ powers)
- **Global Press**: Public announcements to all powers
- **Message Threading**: Reply chains for organized discussions
- **Spectator View**: Omniscient view of all channels for human observers
- **Agent API**: Clean interface for AI agent consumption
- **Real-time Notifications**: Push notifications for new messages

## Usage

```typescript
import {
  PressSystem,
  AgentPressAPI,
  SpectatorAPI,
  createAgentAPIs
} from './src/press';

// Initialize the press system
const press = new PressSystem({
  gameId: 'game-001',
  year: 1901,
  season: 'SPRING',
  phase: 'DIPLOMACY'
});

// Create APIs for all AI agents
const agentAPIs = createAgentAPIs(press);
const englandAPI = agentAPIs.get('ENGLAND')!;

// Send bilateral message
englandAPI.sendTo('FRANCE', 'Shall we discuss the Channel?', {
  intent: 'PROPOSAL'
});

// Create alliance chat
englandAPI.createAlliance(['FRANCE', 'RUSSIA'], 'Triple Entente');

// Broadcast to all
englandAPI.broadcast('We seek only peace.');

// Human spectator watches everything
const spectator = new SpectatorAPI(press);
spectator.onAnyMessage((msg, channel) => {
  console.log(`[${channel.type}] ${msg.sender}: ${msg.content}`);
});
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Architecture

```
src/press/
├── types.ts        # Core type definitions
├── channel.ts      # Channel management
├── press-system.ts # Main system coordinator
├── agent-api.ts    # AI agent interface
├── spectator.ts    # Spectator/observer interface
└── index.ts        # Public exports
```

