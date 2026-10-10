/** Read the token agy is currently using (may be null). */
export declare function getActiveToken(): Promise<string | null>;
/** Write a token into the slot agy reads. */
export declare function setActiveToken(token: string): Promise<void>;
export declare function clearActiveToken(): Promise<void>;
/** Read a stored per-account token from our vault. */
export declare function getVaultToken(accountId: string): Promise<string | null>;
export declare function setVaultToken(accountId: string, token: string): Promise<void>;
export declare function deleteVaultToken(accountId: string): Promise<void>;
/** Find which vault account (if any) already holds this exact token. */
export declare function findVaultOwner(token: string, accountIds: string[]): Promise<string | null>;
