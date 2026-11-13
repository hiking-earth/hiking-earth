export function startBackground(owner: string, session: string, changed: () => void, error: (message: string) => void): boolean;
export function stopBackground(): void;
export function backgroundBuffer(owner: string, legacySession: string): string;
export function acknowledgeBackground(owner: string, timestamp: number): boolean;
