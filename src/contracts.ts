import {z} from 'zod';

export const profileNameSchema = z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9/_-]*$/);
export const contextPathSchema = z.string().min(1).max(500).refine(
  (value) => !value.startsWith('/') && !value.split('/').includes('..'),
  'Path must be relative and cannot contain ..',
);

export const profileFileSchema = z.object({
  path: contextPathSchema,
  size: z.number().int().nonnegative(),
  storagePath: z.string(),
});

export const profileSchema = z.object({
  id: z.string(),
  name: profileNameSchema,
  ownerId: z.string(),
  scope: z.enum(['personal', 'workspace']),
  workspaceSlug: z.string().nullable(),
  inherits: z.array(profileNameSchema),
  currentVersion: z.number().int().positive(),
  files: z.array(profileFileSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal(1),
});

export const bundleSchema = z.object({
  profile: profileSchema,
  resolvedProfiles: z.array(profileSchema),
  files: z.array(z.object({path: contextPathSchema, contentBase64: z.string()})),
});

export const workspaceSchema = z.object({
  slug: z.string(),
  ownerId: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workspaceMemberSchema = z.object({
  uid: z.string(),
  email: z.string().nullable(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string(),
});

export const workspaceInviteSchema = z.object({
  id: z.string(),
  workspaceSlug: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'member']),
  invitedBy: z.string(),
  createdAt: z.string(),
});

export const runSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  profileName: profileNameSchema,
  startedBy: z.string(),
  parentRunId: z.string().nullable(),
  runtime: z.string().nullable(),
  command: z.array(z.string()),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  exitCode: z.number().int().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});

export type Profile = z.infer<typeof profileSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type Run = z.infer<typeof runSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;
