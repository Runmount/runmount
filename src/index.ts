#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {bundleSchema, profileSchema, type Profile} from './contracts.js';
import {api} from './api.js';
import {login, logout} from './auth.js';

const [, , command, ...args] = process.argv;
const encoded = (value: string) => encodeURIComponent(value);
const required = (value: string | undefined, label: string): string => {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

function printProfile(profile: Profile) {
  console.log(`${profile.name}  v${profile.currentVersion}`);
  if (!profile.files.length) console.log('  No files');
  for (const file of profile.files) console.log(`  ${file.path}  ${file.size} bytes`);
}

async function main() {
  switch (command) {
    case 'login': await login(); console.log('Signed in to Runmount.'); return;
    case 'logout': await logout(); console.log('Signed out.'); return;
    case 'create': {
      const name = required(args[0], 'profile name');
      printProfile(profileSchema.parse(await api('/v1/profiles', {method: 'POST', body: JSON.stringify({name})})));
      return;
    }
    case 'add': {
      const name = required(args[0], 'profile name');
      const fileArg = required(args[1], 'file path');
      const absolute = resolve(fileArg);
      const path = args[2] ?? (relative(process.cwd(), absolute).startsWith('..') ? basename(absolute) : relative(process.cwd(), absolute));
      const contentBase64 = (await readFile(absolute)).toString('base64');
      printProfile(profileSchema.parse(await api(`/v1/profiles/${encoded(name)}/files`, {method: 'POST', body: JSON.stringify({path, contentBase64})})));
      return;
    }
    case 'show': {
      const name = required(args[0], 'profile name');
      printProfile(profileSchema.parse(await api(`/v1/profiles/${encoded(name)}`)));
      return;
    }
    case 'exec': {
      const separator = args.indexOf('--');
      const name = required(args[0], 'profile name');
      if (separator < 1) throw new Error('Usage: runmount exec <profile> -- <command>');
      const childCommand = required(args[separator + 1], 'command after --');
      const childArgs = args.slice(separator + 2);
      const bundle = bundleSchema.parse(await api(`/v1/profiles/${encoded(name)}/bundle`));
      const contextDir = await mkdtemp(join(tmpdir(), 'runmount-'));
      try {
        for (const file of bundle.files) {
          const target = resolve(contextDir, file.path);
          if (!target.startsWith(`${contextDir}/`)) throw new Error(`Unsafe context path: ${file.path}`);
          await mkdir(dirname(target), {recursive: true});
          await writeFile(target, Buffer.from(file.contentBase64, 'base64'));
        }
        const exitCode = await new Promise<number>((resolveExit) => {
          const child = spawn(childCommand, childArgs, {
            cwd: contextDir, stdio: 'inherit', env: {...process.env, RUNMOUNT_CONTEXT_DIR: contextDir, RUNMOUNT_PROFILE: name, RUNMOUNT_ORIGINAL_CWD: process.cwd()},
          });
          child.on('error', (error) => { console.error(error.message); resolveExit(1); });
          child.on('exit', (code) => resolveExit(code ?? 1));
        });
        process.exitCode = exitCode;
      } finally { await rm(contextDir, {recursive: true, force: true}); }
      return;
    }
    default:
      console.log('Runmount\n\n  login\n  logout\n  create <profile>\n  add <profile> <file> [context-path]\n  show <profile>\n  exec <profile> -- <command>');
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
