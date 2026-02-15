/**
 * Tests for webhook manager - registration, delivery, HMAC, retries, and dead letter queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookManager, computeSignature } from '../webhooks';
import type { WebhookEventType } from '../webhooks';

describe('WebhookManager', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    manager = new WebhookManager();
  });

  describe('registration', () => {
    it('should register a webhook with valid events', () => {
      const reg = manager.register(
        'https://example.com/hook',
        'secret123',
        ['game.created', 'game.ended'],
        'Test webhook',
      );

      expect(reg.id).toMatch(/^wh_/);
      expect(reg.url).toBe('https://example.com/hook');
      expect(reg.secret).toBe('secret123');
      expect(reg.events).toEqual(['game.created', 'game.ended']);
      expect(reg.active).toBe(true);
      expect(reg.description).toBe('Test webhook');
    });

    it('should reject invalid event types', () => {
      expect(() =>
        manager.register('https://example.com', 'secret', ['invalid.event' as WebhookEventType]),
      ).toThrow('Invalid event type: invalid.event');
    });

    it('should list all registrations', () => {
      manager.register('https://a.com', 's1', ['game.created']);
      manager.register('https://b.com', 's2', ['game.ended']);

      const list = manager.listRegistrations();
      expect(list).toHaveLength(2);
    });

    it('should get a registration by ID', () => {
      const reg = manager.register('https://a.com', 's1', ['game.created']);
      expect(manager.getRegistration(reg.id)).toBe(reg);
      expect(manager.getRegistration('nonexistent')).toBeUndefined();
    });

    it('should unregister a webhook', () => {
      const reg = manager.register('https://a.com', 's1', ['game.created']);
      expect(manager.unregister(reg.id)).toBe(true);
      expect(manager.getRegistration(reg.id)).toBeUndefined();
      expect(manager.unregister('nonexistent')).toBe(false);
    });

    it('should deactivate and reactivate a webhook', () => {
      const reg = manager.register('https://a.com', 's1', ['game.created']);

      expect(manager.deactivate(reg.id)).toBe(true);
      expect(manager.getRegistration(reg.id)!.active).toBe(false);

      expect(manager.activate(reg.id)).toBe(true);
      expect(manager.getRegistration(reg.id)!.active).toBe(true);

      expect(manager.deactivate('nonexistent')).toBe(false);
      expect(manager.activate('nonexistent')).toBe(false);
    });
  });

  describe('HMAC signature', () => {
    it('should produce a deterministic hex signature', () => {
      const sig1 = computeSignature('{"event":"game.created"}', 'mysecret');
      const sig2 = computeSignature('{"event":"game.created"}', 'mysecret');
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = computeSignature('{"event":"game.created"}', 'secret1');
      const sig2 = computeSignature('{"event":"game.created"}', 'secret2');
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different payloads', () => {
      const sig1 = computeSignature('{"event":"game.created"}', 'secret');
      const sig2 = computeSignature('{"event":"game.ended"}', 'secret');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('dispatch and delivery', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('should deliver to matching webhooks', async () => {
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0]!;
      expect(call[0]).toBe('https://a.com/hook');

      const opts = call[1] as RequestInit;
      expect(opts.method).toBe('POST');
      expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect((opts.headers as Record<string, string>)['X-Webhook-Event']).toBe('game.created');
      expect((opts.headers as Record<string, string>)['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

      const body = JSON.parse(opts.body as string);
      expect(body.event).toBe('game.created');
      expect(body.data).toEqual({ gameId: 'g1', name: 'Test' });
    });

    it('should not deliver to inactive webhooks', async () => {
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

      const reg = manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.deactivate(reg.id);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should not deliver to non-matching event webhooks', async () => {
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 'secret', ['game.ended']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should deliver to multiple matching webhooks', async () => {
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 's1', ['game.created']);
      manager.register('https://b.com/hook', 's2', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should track successful deliveries', async () => {
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      const log = manager.getDeliveryLog();
      expect(log).toHaveLength(1);
      expect(log[0].delivered).toBe(true);
      expect(log[0].attempts).toHaveLength(1);
      expect(log[0].attempts[0].success).toBe(true);
      expect(log[0].attempts[0].statusCode).toBe(200);
    });
  });

  describe('retry logic', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should retry on failure and succeed on later attempt', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const log = manager.getDeliveryLog();
      expect(log).toHaveLength(1);
      expect(log[0].delivered).toBe(true);
      expect(log[0].attempts).toHaveLength(2);
      expect(log[0].attempts[0].success).toBe(false);
      expect(log[0].attempts[1].success).toBe(true);
    });

    it('should retry on HTTP error status', async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response('error', { status: 500 }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const log = manager.getDeliveryLog();
      expect(log[0].delivered).toBe(true);
      expect(log[0].attempts[0].statusCode).toBe(500);
      expect(log[0].attempts[1].statusCode).toBe(200);
    });

    it('should add to dead letter queue after all retries exhausted', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });

      await manager.flush();

      expect(fetchSpy).toHaveBeenCalledTimes(3); // MAX_RETRIES = 3

      const log = manager.getDeliveryLog();
      expect(log[0].delivered).toBe(false);
      expect(log[0].attempts).toHaveLength(3);

      const deadLetters = manager.getDeadLetters();
      expect(deadLetters).toHaveLength(1);
      expect(deadLetters[0].webhookUrl).toBe('https://a.com/hook');
      expect(deadLetters[0].reason).toBe('Connection refused');
    });
  });

  describe('dead letter queue', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    it('should clear dead letters', async () => {
      fetchSpy.mockRejectedValue(new Error('fail'));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });
      await manager.flush();

      expect(manager.getDeadLetters()).toHaveLength(1);

      const count = manager.clearDeadLetters();
      expect(count).toBe(1);
      expect(manager.getDeadLetters()).toHaveLength(0);
    });

    it('should retry dead letter entries', async () => {
      fetchSpy
        .mockRejectedValue(new Error('fail'));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });
      await manager.flush();

      const deadLetters = manager.getDeadLetters();
      expect(deadLetters).toHaveLength(1);

      // Now make fetch succeed and retry
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));
      const retried = manager.retryDeadLetter(deadLetters[0].id);
      expect(retried).toBe(true);

      await manager.flush();

      // Dead letter should be removed (re-delivered)
      expect(manager.getDeadLetters()).toHaveLength(0);
    });

    it('should return false for nonexistent dead letter retry', () => {
      expect(manager.retryDeadLetter('nonexistent')).toBe(false);
    });
  });

  describe('stats', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('should report stats correctly', async () => {
      fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

      manager.register('https://a.com/hook', 'secret', ['game.created']);
      manager.register('https://b.com/hook', 'secret', ['game.ended']);
      manager.deactivate(manager.listRegistrations()[1].id);

      manager.dispatch('game.created', { gameId: 'g1', name: 'Test' });
      await manager.flush();

      const stats = manager.getStats();
      expect(stats.registrations).toBe(2);
      expect(stats.activeRegistrations).toBe(1);
      expect(stats.totalDeliveries).toBe(1);
      expect(stats.successfulDeliveries).toBe(1);
      expect(stats.failedDeliveries).toBe(0);
      expect(stats.deadLetters).toBe(0);
      expect(stats.pendingDeliveries).toBe(0);
    });
  });
});
