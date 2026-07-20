import type { BrokerMutation, BrokerPersistence } from './broker.ts';
import type { BrokerSteeringInput, ControlPlaneStore } from './store.ts';

type ContractEnqueueInput = Parameters<BrokerPersistence['enqueueSteering']>[0];
type CheckpointEnqueueInput = ContractEnqueueInput & { checkpoint?: string | null };

/**
 * Binds broker persistence to the already-authenticated dashboard subject. The broker never receives
 * a subject parameter and therefore cannot accidentally read or mutate another operator's run.
 */
export function createSubjectBrokerPersistence(store: ControlPlaneStore, subject: string): BrokerPersistence {
  const boundSubject = subject.trim();
  if (!boundSubject || boundSubject.length > 512 || boundSubject.includes('\0')) {
    throw new Error('an authenticated subject is required for broker persistence');
  }

  return {
    reserveStart(input) {
      return store.brokerReserveStart(boundSubject, {
        spec: {
          runRef: input.spec.runRef,
          sessionRef: input.spec.sessionRef,
          role: input.spec.role,
          profileId: input.spec.profileId,
          approvedPrompt: input.spec.approvedPrompt,
        },
        idempotencyKey: input.idempotencyKey,
      });
    },

    appendEvent(input) {
      store.brokerAppendEvent(boundSubject, {
        runRef: input.runRef,
        sessionRef: input.sessionRef,
        event: input.event,
        idempotencyKey: input.idempotencyKey,
      });
    },

    completeSession(input) {
      return store.brokerCompleteSession(boundSubject, {
        runRef: input.runRef,
        sessionRef: input.sessionRef,
        state: input.state,
        detail: input.detail,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
    },

    requestStop(input) {
      return store.brokerRequestStop(boundSubject, {
        runRef: input.runRef,
        sessionRef: input.sessionRef,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
    },

    enqueueSteering(input: CheckpointEnqueueInput): BrokerMutation {
      const durable: BrokerSteeringInput = {
        runRef: input.runRef,
        sessionRef: input.sessionRef,
        instructionRef: input.instructionRef,
        instruction: input.instruction,
        checkpoint: input.checkpoint ?? null,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      };
      return store.brokerEnqueueSteering(boundSubject, durable);
    },

    consumeSteering(input) {
      return store.brokerConsumeSteering(boundSubject, {
        runRef: input.runRef,
        sessionRef: input.sessionRef,
        checkpoint: input.checkpoint,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
    },

    interruptResidue(input) {
      return store.brokerInterruptResidue(boundSubject, {
        runRef: input.runRef,
        sessionRef: input.sessionRef,
        idempotencyKey: input.idempotencyKey,
      });
    },
  };
}
