import { State } from "./types";
export declare function loadState(): State;
/** Atomic-ish write: write temp file then rename. */
export declare function saveState(state: State): void;
