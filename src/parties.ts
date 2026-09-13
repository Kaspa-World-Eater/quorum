/**
 * Who is in a task, and the on-chain handles a settlement needs to touch them.
 *
 * [[settle]] decides WHAT should happen in the abstract -- pay these workers, slash those. To make
 * that real on the rail you need three concrete things, and no more: the buyer's channel that the
 * price is billed to, where each worker is paid, and each worker's posted bond that a fraud verdict
 * can take. This file is only those handles; it holds no policy and does no chain work.
 */

/** Where a worker is paid, on chain. */
export interface Payee {
  workerId: string;
  /** the worker's Kaspa payout address */
  address: string;
}

/** A bond a worker posted before it was allowed to take the task -- slashable only on `resolved`. */
export interface Bond {
  workerId: string;
  /** the covenant id of the worker's bond escrow on the kaspa-x402 rail */
  covenantId: string;
  amountSompi: bigint;
}

/** Everyone in one task, with the handles a settlement will act on. */
export interface TaskParties {
  /** covenant id of the buyer's channel -- the price is billed here */
  buyerChannel: string;
  payees: Payee[];
  bonds: Bond[];
}

export class UnknownParty extends Error {}

/** The payout address for a worker, or a refusal -- a settlement must not pay into thin air. */
export function payeeFor(parties: TaskParties, workerId: string): Payee {
  const p = parties.payees.find((x) => x.workerId === workerId);
  if (!p) throw new UnknownParty(`no payout address on file for worker ${JSON.stringify(workerId)}`);
  return p;
}

/** The posted bond for a worker, or a refusal -- you cannot slash or release a bond you never held. */
export function bondFor(parties: TaskParties, workerId: string): Bond {
  const b = parties.bonds.find((x) => x.workerId === workerId);
  if (!b) throw new UnknownParty(`no bond on file for worker ${JSON.stringify(workerId)}`);
  return b;
}
