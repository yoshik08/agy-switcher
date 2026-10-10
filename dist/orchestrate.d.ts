import { Account, LimitSignal, State } from "./types";
import { Session } from "./session";
/** Switch to `next` (token swap + relaunch). Caller must have stopped agy already. */
export declare function switchToAccount(session: Session, state: State, next: Account, reason: string): Promise<void>;
/** Handle a detected limit signal. The big autoswitch decision point. */
export declare function handleLimit(session: Session, state: State, signal: LimitSignal): Promise<void>;
/** Minimal optional handoff snapshot. Only ever written when explicitly enabled. */
export declare function writeHandoff(state: State, session: Session, from: Account | null, to: Account, signal: string): string;
/**
 * /add flow: drive agy's own login in the real terminal, capture whatever
 * token agy stored in the keyring, and vault it under a new account.
 * If a session is active it is briefly stopped (then relaunched with resume).
 */
export declare function addAccountFlow(session: Session | null, state: State): Promise<void>;
