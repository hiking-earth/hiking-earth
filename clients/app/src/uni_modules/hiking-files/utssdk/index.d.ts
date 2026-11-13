export function chooseTextFile(success: (text: string) => void, cancel: () => void, fail: (message: string) => void): void;
export function chooseBinaryFile(success: (path: string) => void, cancel: () => void, fail: (message: string) => void): void;
export function removeBinaryFile(path: string): boolean;
export function saveTextFile(name: string, text: string, mimeType: string, success: () => void, cancel: () => void, fail: (message: string) => void): void;

export function verifyApk(path: string, hash: string, size: number): boolean;
