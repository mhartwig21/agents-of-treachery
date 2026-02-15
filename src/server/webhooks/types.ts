/**
 * Webhook notification types and interfaces.
 *
 * Defines the event types, webhook registration shape,
 * delivery records, and dead letter entries.
 */

/**
 * Webhook event types matching game lifecycle events.
 */
export type WebhookEventType =
  | 'game.created'
  | 'game.started'
  | 'game.ended'
  | 'phase.started'
  | 'phase.resolved'
  | 'orders.submitted'
  | 'message.sent';

/**
 * All valid event types for validation.
 */
export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'game.created',
  'game.started',
  'game.ended',
  'phase.started',
  'phase.resolved',
  'orders.submitted',
  'message.sent',
];

/**
 * A registered webhook endpoint.
 */
export interface WebhookRegistration {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  active: boolean;
  createdAt: Date;
  description?: string;
}

/**
 * Payload delivered to webhook endpoints.
 */
export interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  data: WebhookEventData;
}

/**
 * Event-specific data included in webhook payloads.
 */
export type WebhookEventData =
  | GameCreatedData
  | GameStartedData
  | GameEndedData
  | PhaseStartedData
  | PhaseResolvedData
  | OrdersSubmittedData
  | MessageSentData;

export interface GameCreatedData {
  gameId: string;
  name: string;
}

export interface GameStartedData {
  gameId: string;
  year: number;
  season: string;
  phase: string;
}

export interface GameEndedData {
  gameId: string;
  winner?: string;
  draw?: boolean;
}

export interface PhaseStartedData {
  gameId: string;
  year: number;
  season: string;
  phase: string;
}

export interface PhaseResolvedData {
  gameId: string;
  year: number;
  season: string;
  phase: string;
}

export interface OrdersSubmittedData {
  gameId: string;
  power: string;
  orderCount: number;
}

export interface MessageSentData {
  gameId: string;
  sender: string;
  channelId: string;
  preview: string;
}

/**
 * Result of a single delivery attempt.
 */
export interface DeliveryAttempt {
  attemptNumber: number;
  timestamp: Date;
  statusCode?: number;
  error?: string;
  success: boolean;
}

/**
 * A delivery record tracking all attempts for one webhook+event pair.
 */
export interface DeliveryRecord {
  id: string;
  webhookId: string;
  payloadId: string;
  event: WebhookEventType;
  attempts: DeliveryAttempt[];
  delivered: boolean;
  createdAt: Date;
}

/**
 * Dead letter entry for permanently failed deliveries.
 */
export interface DeadLetterEntry {
  id: string;
  webhookId: string;
  webhookUrl: string;
  payload: WebhookPayload;
  attempts: DeliveryAttempt[];
  failedAt: Date;
  reason: string;
}
