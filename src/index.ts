#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {api} from './api.js';
import {login, logout} from './auth.js';
import {bundleSchema, connectionSchema, profileSchema, runSchema, workspaceInviteSchema, workspaceMemberSchema, workspaceSchema, type Bundle, type Connection, type Profile, type Run} from './contracts.js';

const [, , command, ...args] = process.argv;
const encoded = (value: string) => encodeURIComponent(value);
const profileUrl = (reference: string, suffix = '') => `/v1/profile${suffix}?profile=${encoded(reference)}`;
const required = (value: string | undefined, label: string): string => {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const ignoredDirectories = new Set(['.git', '.next', '.runmount', 'build', 'dist', 'node_modules']);
const ignoredFiles = new Set(['.ds_store', 'id_rsa']);
const sensitiveNames = [/^\.env(?:\.|$)/i, /credential/i, /secret/i, /token/i, /\.pem$/i, /\.key$/i, /^id_[a-z0-9_-]+$/i];

function printProfile(profile: Profile) {
  const reference = profile.workspaceSlug ? `${profile.workspaceSlug}/${profile.id}` : profile.id;
  console.log(`${profile.displayName}  ·  ${reference}  ·  v${profile.currentVersion}`);
  if (profile.inherits.length) console.log(`  Inherits: ${profile.inherits.join(', ')}`);
  if (!profile.files.length) console.log('  No files');
  for (const file of profile.files) console.log(`  ${file.path}  ${file.size} bytes  ·  updated ${file.updatedAt}`);
}

function printRun(run: Run) {
  const runtime = run.runtime ? ` · ${run.runtime}` : '';
  const parent = run.parentRunId ? ` · resumed from ${run.parentRunId}` : '';
  console.log(`${run.id}  ${run.status}${runtime}${parent}\n  ${run.profileDisplayName} · ${run.createdAt}`);
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
    profile = profileSchema.parse(await api(profileUrl(name, '/files'), {
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

async function execute(name: string, childCommand: string, childArgs: string[], parentRunId?: string, withProfiles: string[] = []) {
  const withQuery = withProfiles.map((profile) => `&with=${encoded(profile)}`).join('');
  const bundle = bundleSchema.parse(await api(`${profileUrl(name, '/bundle')}${withQuery}`));
  const run = runSchema.parse(await api(profileUrl(name, '/runs'), {
    method: 'POST', body: JSON.stringify({runtime: basename(childCommand), command: [childCommand, ...childArgs], parentRunId}),
  }));
  const contextDir = await materialize(bundle);
  console.log(`Runmount run ${run.id}\nMounted ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'} from ${bundle.resolvedProfiles.length} profile${bundle.resolvedProfiles.length === 1 ? '' : 's'} for ${name}.${bundle.serviceCredentials.length ? ` Loaded ${bundle.serviceCredentials.length} service credential${bundle.serviceCredentials.length === 1 ? '' : 's'}.` : ''}`);
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
          RUNMOUNT_SERVICES: bundle.serviceCredentials.map((service) => service.provider).join(','),
          ...Object.fromEntries(bundle.serviceCredentials.map((service) => [service.environmentVariable, service.secret])),
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
  return {name: required(values[0], 'profile name'), withProfiles: optionValues(values.slice(1, separator), '--with'), childCommand: required(values[separator + 1], 'command after --'), childArgs: values.slice(separator + 2)};
}

function optionValues(values: string[], flag: string) {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === flag) result.push(required(values[index + 1], `value after ${flag}`));
  }
  return result;
}

function optionValue(values: string[], flag: string): string | undefined { return optionValues(values, flag).at(-1); }
function serviceEnvironmentVariable(provider: string) { return `${provider.replaceAll(/[^a-z0-9]+/gi, '_').toUpperCase()}_API_KEY`; }
function printConnection(connection: Connection) { console.log(`${connection.displayName}  ·  ${connection.provider}  ·  ${connection.scope}${connection.workspaceSlug ? ` (${connection.workspaceSlug})` : ''}  ·  ${connection.id}`); }

function usage() {
  console.log(`Runmount

  login | logout
  whoami
  create <organization> <display-name> [--from <profile>]
  personal create <display-name> [--from <profile>]
  delete <profile> --yes
  list
  add <profile> <file-or-directory> [context-path]
  remove <profile> <context-path>
  show <profile>
  mount <profile> [--shell]
  exec <profile> -- <command>
  exec <profile> --with <personal-profile> -- <command>
  runs [profile]
  resume <run-id> -- <command>
  org create <display-name>
  org list
  org invite <workspace> <email> [admin|member]
  org members <workspace>
  org member role <workspace> <firebase-uid> [admin|member]
  org member remove <workspace> <firebase-uid>
  org invites <workspace>
  org invite revoke <workspace> <invite-id>
  org member add <workspace> <firebase-uid> [admin|member]
  service connect <provider> --api-key-env <ENV_VAR> [--workspace <workspace>] [--name <name>] [--env <ENV_VAR>]
  service list [--workspace <workspace>]
  service remove <connection-id>
  profile service add <profile> <provider> <workspace|executing-user|specific|runtime> [connection-id]
  profile overlay add <profile> <provider> <specific|runtime> [connection-id]`);
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
      const workspaceSlug = required(args[0], 'organization');
      const displayName = required(args[1], 'display name');
      const inherits = optionValues(args.slice(2), '--from');
      printProfile(profileSchema.parse(await api('/v1/profiles', {method: 'POST', body: JSON.stringify({workspaceSlug, displayName, inherits})})));
      return;
    }
    case 'personal': {
      if (args[0] !== 'create') throw new Error('Usage: runmount personal create <display-name> [--from <profile>]');
      const displayName = required(args[1], 'display name');
      const inherits = optionValues(args.slice(2), '--from');
      printProfile(profileSchema.parse(await api('/v1/personal/profiles', {method: 'POST', body: JSON.stringify({displayName, inherits})})));
      return;
    }
    case 'delete': {
      const name = required(args[0], 'profile name');
      if (!args.includes('--yes')) throw new Error('Deleting a profile is permanent. Re-run with `--yes`.');
      await api(profileUrl(name), {method: 'DELETE'});
      console.log(`Deleted profile ${name}.`);
      return;
    }
    case 'list': {
      const profiles = profileSchema.array().parse(await api('/v1/profiles'));
      if (!profiles.length) console.log('No profiles yet. Create one with `runmount create <organization> "Display name"`.');
      else profiles.forEach(printProfile);
      return;
    }
    case 'add': await addPath(required(args[0], 'profile name'), required(args[1], 'file or directory'), args[2]); return;
    case 'remove': {
      const name = required(args[0], 'profile name');
      const path = required(args[1], 'context path');
      printProfile(profileSchema.parse(await api(`${profileUrl(name, '/files')}&path=${encoded(path)}`, {method: 'DELETE'})));
      return;
    }
    case 'show': {
      const name = required(args[0], 'profile name');
      printProfile(profileSchema.parse(await api(profileUrl(name))));
      return;
    }
    case 'mount': {
      const name = required(args[0], 'profile name');
      const shell = args.includes('--shell');
      const bundle = bundleSchema.parse(await api(profileUrl(name, '/bundle')));
      const contextDir = await materialize(bundle);
      if (shell) console.log(`export RUNMOUNT_CONTEXT_DIR=${JSON.stringify(contextDir)} RUNMOUNT_PROFILE=${JSON.stringify(name)}`);
      else console.log(`Mounted ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'} from ${bundle.resolvedProfiles.length} profile${bundle.resolvedProfiles.length === 1 ? '' : 's'} at ${contextDir}\n\nSet RUNMOUNT_CONTEXT_DIR to this path before launching your agent, or use \`runmount exec ${name} -- <command>\`.`);
      return;
    }
    case 'exec': {
      const parsed = commandAfterSeparator(args);
      await execute(parsed.name, parsed.childCommand, parsed.childArgs, undefined, parsed.withProfiles);
      return;
    }
    case 'runs': {
      if (args[0]) {
        const runs = runSchema.array().parse(await api(profileUrl(args[0], '/runs')));
        if (!runs.length) console.log(`No runs for ${args[0]}.`);
        else runs.forEach(printRun);
      } else {
        const profiles = profileSchema.array().parse(await api('/v1/profiles'));
        for (const profile of profiles) {
          const reference = profile.workspaceSlug ? `${profile.workspaceSlug}/${profile.id}` : profile.id;
          const runs = runSchema.array().parse(await api(profileUrl(reference, '/runs')));
          runs.forEach(printRun);
        }
      }
      return;
    }
    case 'resume': {
      const separator = args.indexOf('--');
      if (separator < 1) throw new Error('Usage: runmount resume <run-id> -- <command>');
      const prior = runSchema.parse(await api(`/v1/runs/${encoded(required(args[0], 'run id'))}`));
      await execute(prior.profileReference, required(args[separator + 1], 'command after --'), args.slice(separator + 2), prior.id);
      return;
    }
    case 'service': {
      const subcommand = required(args[0], 'service command');
      if (subcommand === 'connect') {
        const provider = required(args[1], 'service provider').toLowerCase();
        const secretEnvironmentVariable = required(optionValue(args.slice(2), '--api-key-env'), '--api-key-env');
        const secret = process.env[secretEnvironmentVariable];
        if (!secret) throw new Error(`${secretEnvironmentVariable} is not set in this shell.`);
        const workspaceSlug = optionValue(args.slice(2), '--workspace');
        const displayName = optionValue(args.slice(2), '--name') ?? provider;
        const environmentVariable = optionValue(args.slice(2), '--env') ?? serviceEnvironmentVariable(provider);
        const connection = connectionSchema.parse(await api('/v1/connections', {method: 'POST', body: JSON.stringify({provider, displayName, scope: workspaceSlug ? 'workspace' : 'personal', workspaceSlug, authType: 'api-key', environmentVariable, secret})}));
        printConnection(connection);
        return;
      }
      if (subcommand === 'list') {
        const workspaceSlug = optionValue(args.slice(1), '--workspace');
        const query = workspaceSlug ? `?workspace=${encoded(workspaceSlug)}` : '';
        const connections = connectionSchema.array().parse(await api(`/v1/connections${query}`));
        if (!connections.length) console.log('No service connections yet.'); else connections.forEach(printConnection);
        return;
      }
      if (subcommand === 'remove') {
        const id = required(args[1], 'connection ID');
        await api(`/v1/connections/${encoded(id)}`, {method: 'DELETE'});
        console.log(`Removed service connection ${id}.`);
        return;
      }
      throw new Error('Usage: runmount service connect | list | remove');
    }
    case 'profile': {
      const target = required(args[0], 'profile command');
      const action = required(args[1], 'profile service action');
      const reference = required(args[2], 'profile');
      const provider = required(args[3], 'service provider').toLowerCase();
      const mode = required(args[4], 'binding mode');
      const connectionId = args[5];
      if (target === 'service' && action === 'add') {
        const profile = profileSchema.parse(await api(profileUrl(reference)));
        const bindings = [...profile.serviceBindings.filter((binding) => binding.provider !== provider), {provider, mode, connectionId, required: true}];
        await api(profileUrl(reference, '/services'), {method: 'PUT', body: JSON.stringify({bindings})});
        console.log(`Attached ${provider} to ${reference}.`);
        return;
      }
      if (target === 'overlay' && action === 'add') {
        const current = await api<{bindings: unknown[]}>(profileUrl(reference, '/overlay'));
        const bindings = [...current.bindings.filter((binding) => typeof binding === 'object' && binding !== null && (binding as {provider?: string}).provider !== provider), {provider, mode, connectionId, required: true}];
        await api(profileUrl(reference, '/overlay'), {method: 'PUT', body: JSON.stringify({bindings})});
        console.log(`Added your personal ${provider} overlay to ${reference}.`);
        return;
      }
      throw new Error('Usage: runmount profile service add | overlay add');
    }
    case 'org': {
      const subcommand = required(args[0], 'org command');
      if (subcommand === 'create') {
        const workspace = workspaceSchema.parse(await api('/v1/workspaces', {method: 'POST', body: JSON.stringify({displayName: required(args[1], 'organization name')})}));
        console.log(`${workspace.displayName}  ·  ${workspace.id}  (${workspace.role})`);
      } else if (subcommand === 'list') {
        const workspaces = workspaceSchema.array().parse(await api('/v1/workspaces'));
        if (!workspaces.length) console.log('No workspaces yet. Create one with `runmount org create "Organization name"`.');
        else workspaces.forEach((workspace) => console.log(`${workspace.displayName}  ·  ${workspace.id}  (${workspace.role})`));
      } else if (subcommand === 'invite' && args[1] === 'revoke') {
        const workspace = required(args[2], 'workspace slug');
        const inviteId = required(args[3], 'invite ID');
        await api(`/v1/workspaces/${encoded(workspace)}/invites/${encoded(inviteId)}`, {method: 'DELETE'});
        console.log(`Revoked invitation ${inviteId}.`);
      } else if (subcommand === 'invite') {
        const workspace = required(args[1], 'workspace slug');
        const email = required(args[2], 'teammate email');
        const role = args[3] ?? 'member';
        const invite = workspaceInviteSchema.parse(await api(`/v1/workspaces/${encoded(workspace)}/invites`, {method: 'POST', body: JSON.stringify({email, role})}));
        console.log(`Invited ${invite.email} to ${workspace} as ${invite.role}. They join automatically the next time they sign in.`);
      } else if (subcommand === 'invites') {
        const workspace = required(args[1], 'workspace slug');
        const invites = workspaceInviteSchema.array().parse(await api(`/v1/workspaces/${encoded(workspace)}/invites`));
        if (!invites.length) console.log(`No pending invitations for ${workspace}.`);
        else invites.forEach((invite) => console.log(`${invite.email}  (${invite.role})  ${invite.id}`));
      } else if (subcommand === 'members') {
        const workspace = required(args[1], 'workspace slug');
        const members = workspaceMemberSchema.array().parse(await api(`/v1/workspaces/${encoded(workspace)}/members`));
        members.forEach((member) => console.log(`${member.email ?? member.uid}  (${member.role})  ${member.uid}`));
      } else if (subcommand === 'member' && args[1] === 'role') {
        const workspace = required(args[2], 'workspace slug');
        const memberUid = required(args[3], 'Firebase user ID');
        const role = required(args[4], 'admin or member role');
        const member = workspaceMemberSchema.parse(await api(`/v1/workspaces/${encoded(workspace)}/members/${encoded(memberUid)}`, {method: 'PATCH', body: JSON.stringify({role})}));
        console.log(`Updated ${member.email ?? member.uid} to ${member.role}.`);
      } else if (subcommand === 'member' && args[1] === 'remove') {
        const workspace = required(args[2], 'workspace slug');
        const memberUid = required(args[3], 'Firebase user ID');
        await api(`/v1/workspaces/${encoded(workspace)}/members/${encoded(memberUid)}`, {method: 'DELETE'});
        console.log(`Removed ${memberUid} from ${workspace}.`);
      } else if (subcommand === 'member' && args[1] === 'add') {
        const workspace = required(args[2], 'workspace slug');
        const uid = required(args[3], 'Firebase user ID');
        const role = args[4] ?? 'member';
        await api(`/v1/workspaces/${encoded(workspace)}/members`, {method: 'POST', body: JSON.stringify({uid, role})});
        console.log(`Added ${uid} to ${workspace} as ${role}.`);
      } else throw new Error('Usage: runmount org create | list | invite | invites | members | member role | member remove');
      return;
    }
    default: usage();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
