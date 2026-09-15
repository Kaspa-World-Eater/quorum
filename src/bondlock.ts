/**
 * The P2SH scriptPublicKey to POST a bond to -- the one piece of bond construction that needs the
 * kaspa-x402 covenant SDK, kept apart from bondtx.ts so that the redeem-script and witness logic
 * (which the live broadcast layer also imports) stays dependency-free and importable anywhere.
 */
import { payToScriptHashScript, serializedScriptPublicKey } from '@kaspa-x402/covenant';

/** Locks funds under this redeem script. Proven primitive (payToScriptHashScript) from the
 *  kaspa-x402 covenant SDK, so it is right offline. The live driver instead derives the bond
 *  ADDRESS from the same redeem script via the WASM SDK; this is quorum's offline representation. */
export function bondLock(redeemHex: string): string {
  return serializedScriptPublicKey(payToScriptHashScript(redeemHex));
}
