import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {authPath, defaults} from './config.js';

type StoredAuth = {idToken: string; refreshToken: string; expiresAt: number};

async function saveAuth(auth: StoredAuth) {
  await mkdir(dirname(authPath), {recursive: true, mode: 0o700});
  await writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, {mode: 0o600});
}

async function exchangeCustomToken(customToken: string): Promise<StoredAuth> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${defaults.firebaseApiKey}`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: customToken, returnSecureToken: true}),
  });
  if (!response.ok) throw new Error(`Firebase token exchange failed: ${await response.text()}`);
  const data = await response.json() as {idToken: string; refreshToken: string; expiresIn: string};
  return {idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: Date.now() + Number(data.expiresIn) * 1000};
}

async function refresh(auth: StoredAuth): Promise<StoredAuth> {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${defaults.firebaseApiKey}`, {
    method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: auth.refreshToken}),
  });
  if (!response.ok) throw new Error('Your session expired. Run `runmount login` again.');
  const data = await response.json() as {id_token: string; refresh_token: string; expires_in: string};
  const updated = {idToken: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in) * 1000};
  await saveAuth(updated);
  return updated;
}

export async function idToken() {
  if (process.env.RUNMOUNT_ID_TOKEN) return process.env.RUNMOUNT_ID_TOKEN;
  let stored: StoredAuth;
  try { stored = JSON.parse(await readFile(authPath, 'utf8')) as StoredAuth; }
  catch { throw new Error('Not signed in. Run `runmount login`.'); }
  return (stored.expiresAt - Date.now() < 60_000 ? await refresh(stored) : stored).idToken;
}

export async function logout() { await rm(authPath, {force: true}); }

export async function login() {
  const state = randomBytes(24).toString('base64url');
  const idTokenFromBrowser = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out.')); }, 5 * 60_000);
    const server = createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', defaults.webUrl);
      response.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
      if (request.method !== 'POST' || request.url !== '/callback') { response.writeHead(404).end(); return; }
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        try {
          const contentType = request.headers['content-type'] ?? '';
          const result = contentType.includes('application/x-www-form-urlencoded')
            ? Object.fromEntries(new URLSearchParams(body)) as {state?: string; idToken?: string}
            : JSON.parse(body) as {state?: string; idToken?: string};
          if (result.state !== state || !result.idToken) throw new Error('Invalid sign-in response.');
          response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end('<!doctype html><title>Runmount connected</title><p>Runmount CLI connected. You can close this tab.</p>');
          clearTimeout(timer); server.close(); resolve(result.idToken);
        } catch (error) { response.writeHead(400).end(); reject(error); }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not start sign-in callback.'));
      const url = `${defaults.webUrl}/?port=${address.port}&state=${encodeURIComponent(state)}`;
      console.log(`Opening ${url}`);
      const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
      spawn(command, args, {detached: true, stdio: 'ignore'}).unref();
    });
  });
  const response = await fetch(`${defaults.apiUrl}/v1/auth/cli/exchange`, {method: 'POST', headers: {authorization: `Bearer ${idTokenFromBrowser}`}});
  if (!response.ok) throw new Error(`Runmount token exchange failed: ${await response.text()}`);
  const {customToken} = await response.json() as {customToken: string};
  await saveAuth(await exchangeCustomToken(customToken));
}
