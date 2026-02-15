/**
 * Webhook Manager - Registration, delivery, and dead letter queue.
 *
 * Handles webhook lifecycle:
 * - Registration and management of webhook endpoints
 * - HMAC-SHA256 signature generation for payload verification
 * - At-least-once delivery with 3 retries and exponential backoff
 * - Dead letter queue for persistent failures
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  WebhookRegistration,
  WebhookPayload,
  WebhookEventType,
  WebhookEventData,
  DeliveryAttempt,
  DeliveryRecord,
  DeadLetterEntry,
} from './types';
import { WEBHOOK_EVENT_TYPES } from './types';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DELIVERY_TIMEOUT_MS = 10000;

/**
 * Generate a random ID for webhooks and payloads.
 */
function generateId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${random}`;
}

/**
 * Compute HMAC-SHA256 signature for a payload.
 */
export function computeSignature(payload: string, secret: string): string {
  const mac = hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(payload));
  return bytesToHex(mac);
}

/**
 * Manages webhook registrations and delivers events.
 */
export class WebhookManager {
  private registrations: Map<string, WebhookRegistration> = new Map();
  private deliveryLog: DeliveryRecord[] = [];
  private deadLetters: DeadLetterEntry[] = [];
  private pendingDeliveries: Map<string, Promise<void>> = new Map();

  /**
   * Register a new webhook endpoint.
   */
  register(url: string, secret: string, events: WebhookEventType[], description?: string): WebhookRegistration {
    // Validate events
    for (const event of events) {
      if (!WEBHOOK_EVENT_TYPES.includes(event)) {
        throw new Error(`Invalid event type: ${event}`);
      }
    }

    const registration: WebhookRegistration = {
      id: generateId('wh'),
      url,
      secret,
      events,
      active: true,
      createdAt: new Date(),
      description,
    };

    this.registrations.set(registration.id, registration);
    return registration;
  }

  /**
   * Unregister a webhook endpoint.
   */
  unregister(id: string): boolean {
    return this.registrations.delete(id);
  }

  /**
   * Deactivate a webhook without removing it.
   */
  deactivate(id: string): boolean {
    const reg = this.registrations.get(id);
    if (!reg) return false;
    reg.active = false;
    return true;
  }

  /**
   * Reactivate a deactivated webhook.
   */
  activate(id: string): boolean {
    const reg = this.registrations.get(id);
    if (!reg) return false;
    reg.active = true;
    return true;
  }

  /**
   * Get a registration by ID.
   */
  getRegistration(id: string): WebhookRegistration | undefined {
    return this.registrations.get(id);
  }

  /**
   * List all registrations.
   */
  listRegistrations(): WebhookRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Dispatch an event to all matching active webhooks.
   * Delivery happens asynchronously with retries.
   */
  dispatch(event: WebhookEventType, data: WebhookEventData): void {
    const payload: WebhookPayload = {
      id: generateId('evt'),
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    for (const reg of this.registrations.values()) {
      if (!reg.active || !reg.events.includes(event)) continue;

      const deliveryId = generateId('dlv');
      const promise = this.deliverWithRetries(reg, payload, deliveryId);
      this.pendingDeliveries.set(deliveryId, promise);
      promise.finally(() => this.pendingDeliveries.delete(deliveryId));
    }
  }

  /**
   * Deliver a payload to a webhook with retry logic.
   */
  private async deliverWithRetries(
    registration: WebhookRegistration,
    payload: WebhookPayload,
    deliveryId: string,
  ): Promise<void> {
    const record: DeliveryRecord = {
      id: deliveryId,
      webhookId: registration.id,
      payloadId: payload.id,
      event: payload.event,
      attempts: [],
      delivered: false,
      createdAt: new Date(),
    };

    const body = JSON.stringify(payload);
    const signature = computeSignature(body, registration.secret);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const attemptRecord: DeliveryAttempt = {
        attemptNumber: attempt,
        timestamp: new Date(),
        success: false,
      };

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

        const response = await fetch(registration.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Event': payload.event,
            'X-Webhook-Id': payload.id,
            'X-Webhook-Timestamp': payload.timestamp,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        attemptRecord.statusCode = response.status;

        if (response.ok) {
          attemptRecord.success = true;
          record.attempts.push(attemptRecord);
          record.delivered = true;
          this.deliveryLog.push(record);
          return;
        }

        attemptRecord.error = `HTTP ${response.status}`;
      } catch (error) {
        attemptRecord.error = error instanceof Error ? error.message : String(error);
      }

      record.attempts.push(attemptRecord);

      // Exponential backoff before next retry
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // All retries exhausted - add to dead letter queue
    record.delivered = false;
    this.deliveryLog.push(record);
    this.addToDeadLetterQueue(registration, payload, record.attempts);
  }

  /**
   * Add a failed delivery to the dead letter queue.
   */
  private addToDeadLetterQueue(
    registration: WebhookRegistration,
    payload: WebhookPayload,
    attempts: DeliveryAttempt[],
  ): void {
    const lastAttempt = attempts[attempts.length - 1];
    const entry: DeadLetterEntry = {
      id: generateId('dlq'),
      webhookId: registration.id,
      webhookUrl: registration.url,
      payload,
      attempts,
      failedAt: new Date(),
      reason: lastAttempt?.error ?? 'Unknown failure',
    };

    this.deadLetters.push(entry);
    console.error(
      `[Webhook DLQ] Failed delivery to ${registration.url} for event ${payload.event}: ${entry.reason}`,
    );
  }

  /**
   * Get dead letter queue entries.
   */
  getDeadLetters(): DeadLetterEntry[] {
    return [...this.deadLetters];
  }

  /**
   * Clear dead letter queue (e.g. after investigation).
   */
  clearDeadLetters(): number {
    const count = this.deadLetters.length;
    this.deadLetters = [];
    return count;
  }

  /**
   * Retry a specific dead letter entry.
   */
  retryDeadLetter(deadLetterId: string): boolean {
    const index = this.deadLetters.findIndex(dl => dl.id === deadLetterId);
    if (index === -1) return false;

    const entry = this.deadLetters[index];
    const reg = this.registrations.get(entry.webhookId);
    if (!reg) return false;

    // Remove from dead letters
    this.deadLetters.splice(index, 1);

    // Re-dispatch
    const deliveryId = generateId('dlv');
    const promise = this.deliverWithRetries(reg, entry.payload, deliveryId);
    this.pendingDeliveries.set(deliveryId, promise);
    promise.finally(() => this.pendingDeliveries.delete(deliveryId));

    return true;
  }

  /**
   * Get recent delivery records for debugging.
   */
  getDeliveryLog(limit: number = 50): DeliveryRecord[] {
    return this.deliveryLog.slice(-limit);
  }

  /**
   * Get stats summary.
   */
  getStats(): {
    registrations: number;
    activeRegistrations: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    deadLetters: number;
    pendingDeliveries: number;
  } {
    const successful = this.deliveryLog.filter(d => d.delivered).length;
    const failed = this.deliveryLog.filter(d => !d.delivered).length;

    return {
      registrations: this.registrations.size,
      activeRegistrations: Array.from(this.registrations.values()).filter(r => r.active).length,
      totalDeliveries: this.deliveryLog.length,
      successfulDeliveries: successful,
      failedDeliveries: failed,
      deadLetters: this.deadLetters.length,
      pendingDeliveries: this.pendingDeliveries.size,
    };
  }

  /**
   * Wait for all pending deliveries to complete.
   * Useful for testing and graceful shutdown.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingDeliveries.values());
  }
}
