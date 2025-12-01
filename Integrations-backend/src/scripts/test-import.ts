
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

console.log('Importing tokenManager...');
import tokenManager from '../utils/tokenManager';
console.log('tokenManager imported.');

console.log('Done.');
