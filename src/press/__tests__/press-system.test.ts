/**
 * Tests for the Diplomacy press system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PressSystem } from '../press-system';
import { AgentPressAPI, createAgentAPIs } from '../agent-api';
import { SpectatorAPI } from '../spectator';
import { ChannelManager, getBilateralChannelId, GLOBAL_CHANNEL_ID } from '../channel';
import { Power, PressContext, Message } from '../types';

const createTestContext = (): PressContext => ({
  gameId: 'test-game',
  year: 1901,
  season: 'SPRING',
  phase: 'DIPLOMACY',
});

describe('ChannelManager', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager();
  });

  it('creates bilateral channels for all power pairs', () => {
    // 7 powers = 21 bilateral channels (7 choose 2)
    const channels = manager.getAllChannels();
    const bilateralChannels = channels.filter((c) => c.type === 'BILATERAL');
    expect(bilateralChannels).toHaveLength(21);
  });

  it('creates a global channel', () => {
    const globalChannel = manager.getGlobalChannel();
    expect(globalChannel).toBeDefined();
    expect(globalChannel.type).toBe('GLOBAL');
    expect(globalChannel.participants).toHaveLength(7);
  });

  it('returns consistent bilateral channel IDs', () => {
    const id1 = getBilateralChannelId('ENGLAND', 'FRANCE');
    const id2 = getBilateralChannelId('FRANCE', 'ENGLAND');
    expect(id1).toBe(id2);
  });

  it('creates multiparty channels', () => {
    const channel = manager.createMultipartyChannel({
      participants: ['ENGLAND', 'FRANCE', 'RUSSIA'],
      name: 'Triple Entente',
    });

    expect(channel.type).toBe('MULTIPARTY');
    expect(channel.participants).toContain('ENGLAND');
    expect(channel.participants).toContain('FRANCE');
    expect(channel.participants).toContain('RUSSIA');
    expect(channel.name).toBe('Triple Entente');
  });

  it('rejects multiparty channels with fewer than 3 participants', () => {
    expect(() =>
      manager.createMultipartyChannel({
        participants: ['ENGLAND', 'FRANCE'],
      })
    ).toThrow();
  });

  it('returns channels for a specific power', () => {
    const englandChannels = manager.getChannelsForPower('ENGLAND');

    // 6 bilateral (with each other power) + 1 global = 7
    expect(englandChannels).toHaveLength(7);
  });
});

describe('PressSystem', () => {
  let press: PressSystem;
  let context: PressContext;

  beforeEach(() => {
    context = createTestContext();
    press = new PressSystem(context);
  });

  describe('sending messages', () => {
    it('sends bilateral messages', () => {
      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');
      const message = press.sendMessage('ENGLAND', {
        channelId,
        content: 'Hello France!',
      });

      expect(message.sender).toBe('ENGLAND');
      expect(message.content).toBe('Hello France!');
      expect(message.channelId).toBe(channelId);
    });

    it('sends global messages', () => {
      const message = press.sendMessage('ENGLAND', {
        channelId: GLOBAL_CHANNEL_ID,
        content: 'Hear ye, hear ye!',
      });

      expect(message.sender).toBe('ENGLAND');
      expect(message.channelId).toBe(GLOBAL_CHANNEL_ID);
    });

    it('rejects messages to channels power is not in', () => {
      const channelId = getBilateralChannelId('FRANCE', 'GERMANY');

      expect(() =>
        press.sendMessage('ENGLAND', {
          channelId,
          content: 'I should not be here',
        })
      ).toThrow(/not a participant/);
    });

    it('enforces message length limits', () => {
      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');
      const longContent = 'x'.repeat(3000);

      expect(() =>
        press.sendMessage('ENGLAND', {
          channelId,
          content: longContent,
        })
      ).toThrow(/maximum length/);
    });

    it('supports message threading', () => {
      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');

      const msg1 = press.sendMessage('ENGLAND', {
        channelId,
        content: 'Let us ally?',
      });

      const msg2 = press.sendMessage('FRANCE', {
        channelId,
        content: 'I agree!',
        replyTo: msg1.id,
      });

      expect(msg2.replyTo).toBe(msg1.id);

      // Query thread
      const thread = press.queryMessages({ threadId: msg1.id });
      expect(thread.messages).toHaveLength(2);
    });

    it('includes metadata when configured', () => {
      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');

      const message = press.sendMessage('ENGLAND', {
        channelId,
        content: 'Let us take Belgium together',
        metadata: {
          intent: 'PROPOSAL',
          references: ['BEL'],
        },
      });

      expect(message.metadata?.intent).toBe('PROPOSAL');
      expect(message.metadata?.references).toContain('BEL');
    });
  });

  describe('notifications', () => {
    it('notifies participants when messages are sent', () => {
      const notifications: { power: Power; channelId: string }[] = [];

      press.onNotification((power, notification) => {
        if (notification.type === 'NEW_MESSAGE') {
          notifications.push({ power, channelId: notification.channel.id });
        }
      });

      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');
      press.sendMessage('ENGLAND', {
        channelId,
        content: 'Hello!',
      });

      // Both England and France should be notified
      expect(notifications).toHaveLength(2);
      expect(notifications.map((n) => n.power).sort()).toEqual(['ENGLAND', 'FRANCE']);
    });
  });

  describe('querying messages', () => {
    it('queries messages by channel', () => {
      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');

      press.sendMessage('ENGLAND', { channelId, content: 'Message 1' });
      press.sendMessage('FRANCE', { channelId, content: 'Message 2' });

      const result = press.queryMessages({ channelId });
      expect(result.messages).toHaveLength(2);
    });

    it('queries messages by sender', () => {
      const ef = getBilateralChannelId('ENGLAND', 'FRANCE');
      const eg = getBilateralChannelId('ENGLAND', 'GERMANY');

      press.sendMessage('ENGLAND', { channelId: ef, content: 'To France' });
      press.sendMessage('FRANCE', { channelId: ef, content: 'To England' });
      press.sendMessage('ENGLAND', { channelId: eg, content: 'To Germany' });

      const result = press.queryMessages({ sender: 'ENGLAND' });
      expect(result.messages).toHaveLength(2);
    });

    it('applies limit to query results', () => {
      const channelId = getBilateralChannelId('ENGLAND', 'FRANCE');

      for (let i = 0; i < 10; i++) {
        press.sendMessage('ENGLAND', { channelId, content: `Message ${i}` });
      }

      const result = press.queryMessages({ channelId, limit: 5 });
      expect(result.messages).toHaveLength(5);
      expect(result.hasMore).toBe(true);
    });
  });
});

describe('AgentPressAPI', () => {
  let press: PressSystem;
  let englandAPI: AgentPressAPI;
  let franceAPI: AgentPressAPI;

  beforeEach(() => {
    press = new PressSystem(createTestContext());
    englandAPI = new AgentPressAPI(press, 'ENGLAND');
    franceAPI = new AgentPressAPI(press, 'FRANCE');
  });

  it('sends messages to other powers', () => {
    const result = englandAPI.sendTo('FRANCE', 'Hello France!');

    expect(result.success).toBe(true);
    expect(result.data?.sender).toBe('ENGLAND');
    expect(result.data?.content).toBe('Hello France!');
  });

  it('cannot send messages to self', () => {
    const result = englandAPI.sendTo('ENGLAND', 'Talking to myself');
    expect(result.success).toBe(false);
    expect(result.error).toContain('yourself');
  });

  it('broadcasts to all powers', () => {
    const result = englandAPI.broadcast('Peace in our time!');

    expect(result.success).toBe(true);
    expect(result.data?.channelId).toBe(GLOBAL_CHANNEL_ID);
  });

  it('replies to messages', () => {
    const msg1 = englandAPI.sendTo('FRANCE', 'Alliance?');
    expect(msg1.success).toBe(true);

    const msg2 = franceAPI.replyTo(msg1.data!.id, 'Yes!');
    expect(msg2.success).toBe(true);
    expect(msg2.data?.replyTo).toBe(msg1.data!.id);
  });

  it('creates alliance channels', () => {
    const result = englandAPI.createAlliance(
      ['FRANCE', 'RUSSIA'],
      'Triple Entente'
    );

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('MULTIPARTY');
    expect(result.data?.participants).toContain('ENGLAND');
    expect(result.data?.participants).toContain('FRANCE');
    expect(result.data?.participants).toContain('RUSSIA');
  });

  it('gets inbox summary', () => {
    englandAPI.sendTo('FRANCE', 'Hello!');

    const inbox = franceAPI.getInbox();
    expect(inbox.unreadCount).toBeGreaterThan(0);
    expect(inbox.recentMessages.length).toBeGreaterThan(0);
  });

  it('gets conversation with specific power', () => {
    englandAPI.sendTo('FRANCE', 'Message 1');
    franceAPI.sendTo('ENGLAND', 'Message 2');

    const result = englandAPI.getConversationWith('FRANCE');
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('tracks notifications', () => {
    expect(franceAPI.hasNotifications()).toBe(false);

    englandAPI.sendTo('FRANCE', 'Hello!');

    expect(franceAPI.hasNotifications()).toBe(true);

    const notifications = franceAPI.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message?.content).toBe('Hello!');

    expect(franceAPI.hasNotifications()).toBe(false);
  });
});

describe('SpectatorAPI', () => {
  let press: PressSystem;
  let spectator: SpectatorAPI;
  let agentAPIs: Map<Power, AgentPressAPI>;

  beforeEach(() => {
    press = new PressSystem(createTestContext());
    spectator = new SpectatorAPI(press);
    agentAPIs = createAgentAPIs(press);
  });

  it('sees all messages', () => {
    agentAPIs.get('ENGLAND')!.sendTo('FRANCE', 'Secret to France');
    agentAPIs.get('GERMANY')!.sendTo('AUSTRIA', 'Secret to Austria');
    agentAPIs.get('ENGLAND')!.broadcast('Public announcement');

    const view = spectator.getFullView();
    expect(view.recentMessages).toHaveLength(3);
  });

  it('separates public and private messages', () => {
    agentAPIs.get('ENGLAND')!.sendTo('FRANCE', 'Private message');
    agentAPIs.get('ENGLAND')!.broadcast('Public message');

    const privateMessages = spectator.getPrivateMessagesFrom('ENGLAND');
    const publicMessages = spectator.getPublicMessagesFrom('ENGLAND');

    expect(privateMessages).toHaveLength(1);
    expect(publicMessages).toHaveLength(1);
  });

  it('computes statistics', () => {
    agentAPIs.get('ENGLAND')!.sendTo('FRANCE', 'Hello');
    agentAPIs.get('ENGLAND')!.sendTo('GERMANY', 'Hello');
    agentAPIs.get('FRANCE')!.sendTo('ENGLAND', 'Hi');

    const stats = spectator.getStatistics();

    expect(stats.totalMessages).toBe(3);
    expect(stats.messagesByPower.get('ENGLAND')).toBe(2);
    expect(stats.messagesByPower.get('FRANCE')).toBe(1);
    expect(stats.mostActivePower).toBe('ENGLAND');
  });

  it('builds relationship graph', () => {
    agentAPIs.get('ENGLAND')!.sendTo('FRANCE', 'Hello');
    agentAPIs.get('FRANCE')!.sendTo('ENGLAND', 'Hi');
    agentAPIs.get('ENGLAND')!.sendTo('GERMANY', 'Hey');

    const graph = spectator.getRelationshipGraph();

    expect(graph.get('ENGLAND-FRANCE')).toBe(2);
    expect(graph.get('ENGLAND-GERMANY')).toBe(1);
  });

  it('watches messages in real-time', () => {
    const received: Message[] = [];

    const unsubscribe = spectator.onAnyMessage((message) => {
      received.push(message);
    });

    agentAPIs.get('ENGLAND')!.sendTo('FRANCE', 'Hello');
    agentAPIs.get('GERMANY')!.broadcast('Announcement');

    expect(received).toHaveLength(2);

    unsubscribe();

    agentAPIs.get('ITALY')!.sendTo('AUSTRIA', 'Ciao');
    expect(received).toHaveLength(2); // No new messages after unsubscribe
  });

  it('gets bilateral conversations', () => {
    agentAPIs.get('ENGLAND')!.sendTo('FRANCE', 'Hello France');
    agentAPIs.get('FRANCE')!.sendTo('ENGLAND', 'Hello England');

    const conversation = spectator.getBilateralConversation('ENGLAND', 'FRANCE');
    expect(conversation).toHaveLength(2);
  });
});

describe('createAgentAPIs', () => {
  it('creates APIs for all powers', () => {
    const press = new PressSystem(createTestContext());
    const apis = createAgentAPIs(press);

    expect(apis.size).toBe(7);
    expect(apis.get('ENGLAND')).toBeDefined();
    expect(apis.get('FRANCE')).toBeDefined();
    expect(apis.get('GERMANY')).toBeDefined();
    expect(apis.get('ITALY')).toBeDefined();
    expect(apis.get('AUSTRIA')).toBeDefined();
    expect(apis.get('RUSSIA')).toBeDefined();
    expect(apis.get('TURKEY')).toBeDefined();
  });
});
