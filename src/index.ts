#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {api} from './api.js';
import {login, logout} from './auth.js';
import {bundleSchema, profileSchema, runSchema, workspaceSchema, type Bundle, type Profile, type Run} from './contracts.js';

const [, , command, ...args] = process.argv;
const encoded = (value: string) => encodeURIComponent(value);
const required = (value: string | undefined, label: string): string => {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const ignoredDirectories = new Set(['.git', '.next', '.runmount', 'build', 'dist', 'node_modules']);
const ignoredFiles = new Set(['.ds_store', 'id_rsa']);
const sensitiveNames = [/^\.env(?:\.|$)/i, /credential/i, /secret/i, /token/i, /\.pem$/i, /\.key$/i, /^id_[a-z0-9_-]+$/i];

function printProfile(profile: Profile) {
  const scope = profile.workspaceSlug ? `workspace ${profile.workspaceSlug}` : 'personal';
  console.log(`${profile.name}  v${profile.currentVersion}  (${scope})`);
  if (profile.inherits.length) console.log(`  Inherits: ${profile.inherits.join(', ')}`);
  if (!profile.files.length) console.log('  No files');
  for (const file of profile.files) console.log(`  ${file.path}  ${file.size} bytes`);
}

function printRun(run: Run) {
  const runtime = run.runtime ? ` · ${run.runtime}` : '';
  const parent = run.parentRunId ? ` · resumed from ${run.parentRunId}` : '';
  console.log(`${run.id}  ${run.status}${runtime}${parent}\n  ${run.profileName} · ${run.createdAt}`);
}

function shouldSkip(path: string, isDirectory: boolean) {
  const name = basename(path).toLowerCase();
  return isDirectory ? ignoredDirectories.has(name) : ignoredFiles.has(name) || sensitiveNames.some((pattern) => pattern.test(name));
}

async function collectFiles(root: string): Promise<string[]> {
  const entry = await stat(root);
  if (entry.isFile()) {
    if (shouldSkip(root, false)) throw new Error(`Refusing to add sensitive or generated file: ${basename(root)}`);
    return [root];
  }
  if (!entry.isDirectory()) throw new Error(`Not a regular file or directory: ${root}`);
  const files: string[] = [];
  async function walk(directory: string) {
    for (const child of await readdir(directory, {withFileTypes: true})) {
      const absolute = join(directory, child.name);
      if (shouldSkip(absolute, child.isDirectory())) continue;
      if (child.isDirectory()) await walk(absolute);
      else if (child.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  return files.sort();
}

async function addPath(name: string, pathArg: string, contextRoot?: string) {
  const absolute = resolve(pathArg);
  const source = await stat(absolute);
  const files = await collectFiles(absolute);
  if (!files.length) throw new Error(`No uploadable files found in ${pathArg}.`);
  const root = contextRoot ?? (source.isDirectory() ? basename(absolute) : (relative(process.cwd(), absolute).startsWith('..') ? basename(absolute) : relative(process.cwd(), absolute)));
  let profile: Profile | undefined;
  for (const file of files) {
    const childPath = source.isDirectory() ? join(root, relative(absolute, file)) : root;
    const contentBase64 = (await readFile(file)).toString('base64');
    profile = profileSchema.parse(await api(`/v1/profiles/${encoded(name)}/files`, {
      method: 'POST', body: JSON.stringify({path: childPath.replaceAll('\\', '/'), contentBase64}),
    }));
  }
  if (profile) printProfile(profile);
  console.log(`Added ${files.length} file${files.length === 1 ? '' : 's'}.`);
}

async function materialize(bundle: Bundle) {
  const contextDir = await mkdtemp(join(tmpdir(), 'runmount-'));
  for (const file of bundle.files) {
    const target = resolve(contextDir, file.path);
    if (!target.startsWith(`${contextDir}/`)) throw new Error(`Unsafe context path: ${file.path}`);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, Buffer.from(file.contentBase64, 'base64'));
  }
  return contextDir;
}

async function execute(name: string, childCommand: string, childArgs: string[], parentRunId?: string) {
  const bundle = bundleSchema.parse(await api(`/v1/profiles/${encoded(name)}/bundle`));
  const run = runSchema.parse(await api(`/v1/profiles/${encoded(name)}/runs`, {
    method: 'POST', body: JSON.stringify({runtime: basename(childCommand), command: [childCommand, ...childArgs], parentRunId}),
  }));
  const contextDir = await materialize(bundle);
  console.log(`Runmount run ${run.id}\nMounted ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'} from ${bundle.resolvedProfiles.length} profile${bundle.resolvedProfiles.length === 1 ? '' : 's'} for ${name}.`);
  try {
    const exitCode = await new Promise<number>((resolveExit) => {
      const child = spawn(childCommand, childArgs, {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: {
          ...process.env,
          RUNMOUNT_CONTEXT_DIR: contextDir,
          RUNMOUNT_PROFILE: name,
          RUNMOUNT_RUN_ID: run.id,
          RUNMOUNT_ORIGINAL_CWD: process.cwd(),
        },
      });
      child.on('error', (error) => { console.error(error.message); resolveExit(1); });
      child.on('exit', (code) => resolveExit(code ?? 1));
    });
    const status = exitCode === 0 ? 'succeeded' : 'failed';
    await api(`/v1/runs/${encoded(run.id)}`, {method: 'PATCH', body: JSON.stringify({status, exitCode})});
    process.exitCode = exitCode;
  } catch (error) {
    await api(`/v1/runs/${encoded(run.id)}`, {method: 'PATCH', body: JSON.stringify({status: 'failed', exitCode: 1})}).catch(() => undefined);
    throw error;
  } finally {
    await rm(contextDir, {recursive: true, force: true});
  }
}

function commandAfterSeparator(values: string[]) {
  const separator = values.indexOf('--');
  if (separator < 1) throw new Error('Usage: runmount exec <profile> -- <command>');
  return {name: required(values[0], 'profile name'), childCommand: required(values[separator + 1], 'command after --'), childArgs: values.slice(separator + 2)};
}

function optionValues(values: string[], flag: string) {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === flag) result.push(required(values[index + 1], `value after ${flag}`));
  }
  return result;
}

function usage() {
  console.log(`Runmount

  login | logout
  whoami
  create <profile> [--from <profile>]
  list
  add <profile> <file-or-directory> [context-path]
  remove <profile> <context-path>
  show <profile>
  mount <profile> [--shell]
  exec <profile> -- <command>
  runs [profile]
  resume <run-id> -- <command>
  org create <slug>
  org list
  org member add <workspace> <firebase-uid> [owner|admin|member]`);
}

async function main() {
  switch (command) {
    case 'login': await login(); console.log('Signed in to Runmount.'); return;
    case 'logout': await logout(); console.log('Signed out.'); return;
    case 'whoami': {
      const identity = await api<{uid: string}>('/v1/me');
      console.log(identity.uid);
      return;
    }
    case 'create': {
      const name = required(args[0], 'profile name');
      const inherits = optionValues(args.slice(1), '--from');
      printProfile(profileSchema.parse(await api('/v1/profiles', {method: 'POST', body: JSON.stringify({name, inherits})})));
      return;
    }
    case 'list': {
      const profiles = profileSchema.array().parse(await api('/v1/profiles'));
      if (!profiles.length) console.log('No profiles yet. Create one with `runmount create <name>`.');
      else profiles.forEach(printProfile);
      return;
    }
    case 'add': await addPath(required(args[0], 'profile name'), required(args[1], 'file or directory'), args[2]); return;
    case 'remove': {
      const name = required(args[0], 'profile name');
      const path = required(args[1], 'context path');
      printProfile(profileSchema.parse(await api(`/v1/profiles/${encoded(name)}/files/${encoded(path)}`, {method: 'DELETE'})));
      return;
    }
    case 'show': {
      const name = required(args[0], 'profile name');
      printProfile(profileSchema.parse(await api(`/v1/profiles/${encoded(name)}`)));
      return;
    }
    case 'mount': {
      const name = required(args[0], 'profile name');
      const shell = args.includes('--shell');
      const bundle = bundleSchema.parse(await api(`/v1/profiles/${encoded(name)}/bundle`));
      const contextDir = await materialize(bundle);
      if (shell) console.log(`export RUNMOUNT_CONTEXT_DIR=${JSON.stringify(contextDir)} RUNMOUNT_PROFILE=${JSON.stringify(name)}`);
      else console.log(`Mounted ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'} from ${bundle.resolvedProfiles.length} profile${bundle.resolvedProfiles.length === 1 ? '' : 's'} at ${contextDir}\n\nSet RUNMOUNT_CONTEXT_DIR to this path before launching your agent, or use \`runmount exec ${name} -- <command>\`.`);
      return;
    }
    case 'exec': {
      const parsed = commandAfterSeparator(args);
      await execute(parsed.name, parsed.childCommand, parsed.childArgs);
      return;
    }
    case 'runs': {
      if (args[0]) {
        const runs = runSchema.array().parse(await api(`/v1/profiles/${encoded(args[0])}/runs`));
        if (!runs.length) console.log(`No runs for ${args[0]}.`);
        else runs.forEach(printRun);
      } else {
        const profiles = profileSchema.array().parse(await api('/v1/profiles'));
        for (const profile of profiles) {
          const runs = runSchema.array().parse(await api(`/v1/profiles/${encoded(profile.name)}/runs`));
          runs.forEach(printRun);
        }
      }
      return;
    }
    case 'resume': {
      const separator = args.indexOf('--');
      if (separator < 1) throw new Error('Usage: runmount resume <run-id> -- <command>');
      const prior = runSchema.parse(await api(`/v1/runs/${encoded(required(args[0], 'run id'))}`));
      await execute(prior.profileName, required(args[separator + 1], 'command after --'), args.slice(separator + 2), prior.id);
      return;
    }
    case 'org': {
      const subcommand = required(args[0], 'org command');
      if (subcommand === 'create') {
        const workspace = workspaceSchema.parse(await api('/v1/workspaces', {method: 'POST', body: JSON.stringify({slug: required(args[1], 'workspace slug')})}));
        console.log(`${workspace.slug}  (${workspace.role})`);
      } else if (subcommand === 'list') {
        const workspaces = workspaceSchema.array().parse(await api('/v1/workspaces'));
        if (!workspaces.length) console.log('No workspaces yet. Create one with `runmount org create <slug>`.');
        else workspaces.forEach((workspace) => console.log(`${workspace.slug}  (${workspace.role})`));
      } else if (subcommand === 'member' && args[1] === 'add') {
        const workspace = required(args[2], 'workspace slug');
        const uid = required(args[3], 'Firebase user ID');
        const role = args[4] ?? 'member';
        await api(`/v1/workspaces/${encoded(workspace)}/members`, {method: 'POST', body: JSON.stringify({uid, role})});
        console.log(`Added ${uid} to ${workspace} as ${role}.`);
      } else throw new Error('Usage: runmount org create <slug> | list | member add <workspace> <firebase-uid> [role]');
      return;
    }
    default: usage();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
