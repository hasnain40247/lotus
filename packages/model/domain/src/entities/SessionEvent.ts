/**
 * SessionEvent entity — re-exported from @gco/schema with no duplication.
 *
 * Includes both the full `All` event union and the `Durable` subset that is
 * persisted to the event store (Firestore subcollection in production,
 * in-memory array in tests).
 */
export { SessionEvent } from "@gco/schema"
