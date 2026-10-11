export declare function getActiveToken(): Promise<string | null>;
export declare function setActiveToken(token: string): Promise<void>;
export declare function getVaultToken(accountId: string): Promise<string | null>;
export declare function setVaultToken(accountId: string, token: string): Promise<void>;
export declare function deleteVaultToken(accountId: string): Promise<void>;
export declare function findVaultOwner(token: string, accountIds: string[]): Promise<string | null>;
