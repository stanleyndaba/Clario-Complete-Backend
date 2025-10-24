export declare const encryptToken: (text: string) => string;
export declare const decryptToken: (encryptedText: string) => string;
export declare const hashPassword: (password: string) => Promise<string>;
export declare const verifyPassword: (password: string, hashedPassword: string) => Promise<boolean>;
export declare const generateRandomString: (length?: number) => string;
export declare const generateSecureToken: () => string;
//# sourceMappingURL=encryption.d.ts.map