import { authenticateToken } from '../src/middleware/authMiddleware';
import * as gmailController from '../src/controllers/gmailController';

console.log('--- Debug Gmail Imports ---');
console.log('authenticateToken:', typeof authenticateToken);
console.log('getGmailEmails:', typeof (gmailController as any).getGmailEmails);
console.log('searchGmailEmails:', typeof (gmailController as any).searchGmailEmails);
console.log('initiateGmailOAuth:', typeof (gmailController as any).initiateGmailOAuth);
console.log('handleGmailCallback:', typeof (gmailController as any).handleGmailCallback);
console.log('getGmailStatus:', typeof (gmailController as any).getGmailStatus);
console.log('disconnectGmail:', typeof (gmailController as any).disconnectGmail);
console.log('--- End Debug ---');
