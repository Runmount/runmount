import {homedir} from 'node:os';
import {join} from 'node:path';

export const defaults = {
  apiUrl: process.env.RUNMOUNT_API_URL ?? 'https://api.runmount.com',
  webUrl: process.env.RUNMOUNT_WEB_URL ?? 'https://app.runmount.com',
  firebaseApiKey: 'AIzaSyCJwRe6LyBYTmJz_CEMSIwKL2jb9g-DSZw',
};
export const authPath = join(homedir(), '.config', 'runmount', 'auth.json');
