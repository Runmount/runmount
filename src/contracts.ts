import {z} from 'zod';

export const workspaceSlugSchema = z.string().min(2).max(60).regex(/^[a-z0-9][a-z0-9-]*$/);
export const workspaceDisplayNameSchema = z.string().trim().min(1).max(120);
export const profileIdSchema = z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
export const profileReferenceSchema = z.string().min(3).max(126).regex(/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*[a-z0-9])?$/);
export const profileDisplayNameSchema = z.string().trim().min(1).max(120);
export const contextPathSchema = z.string().min(1).max(500).refine(
  (value) => !value.startsWith('/') && !value.split('/').includes('..'),
  'Path must be relative and cannot contain ..',
);

export const createProfileSchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  displayName: profileDisplayNameSchema,
  inherits: z.array(profileReferenceSchema).max(20).default([]),
});
export const updateProfileSchema = z.object({displayName: profileDisplayNameSchema});
export const serviceProviderSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
export const connectionIdSchema = z.string().min(8).max(80).regex(/^connection_[a-z0-9]+$/);
export const serviceBindingModeSchema = z.enum(['workspace', 'executing-user', 'specific', 'runtime']);
export const serviceBindingSchema = z.object({provider: serviceProviderSchema, mode: serviceBindingModeSchema, connectionId: connectionIdSchema.optional(), required: z.boolean().default(true)});
export const connectionSchema = z.object({id: connectionIdSchema, provider: serviceProviderSchema, displayName: z.string(), scope: z.enum(['personal', 'workspace']), workspaceSlug: workspaceSlugSchema.nullable(), ownerId: z.string(), authType: z.enum(['api-key', 'oauth']), environmentVariable: z.string(), status: z.enum(['active', 'revoked']), createdAt: z.string(), updatedAt: z.string(), lastUsedAt: z.string().nullable()});
export const addFileSchema = z.object({
  path: contextPathSchema,
  contentBase64: z.string(),
});
export const createWorkspaceSchema = z.object({displayName: workspaceDisplayNameSchema});
export const updateWorkspaceSchema = z.object({displayName: workspaceDisplayNameSchema});
export const workspaceRoleSchema = z.enum(['owner', 'admin', 'member']);
export const manageableWorkspaceRoleSchema = z.enum(['admin', 'member']);
export const addWorkspaceMemberSchema = z.object({
  uid: z.string().min(1).max(128),
  role: workspaceRoleSchema.default('member'),
});
export const inviteWorkspaceMemberSchema = z.object({
  email: z.string().email().max(320),
  role: manageableWorkspaceRoleSchema.default('member'),
});
export const updateWorkspaceMemberSchema = z.object({role: manageableWorkspaceRoleSchema});
export const createRunSchema = z.object({
  runtime: z.string().min(1).max(100).optional(),
  command: z.array(z.string().min(1).max(500)).max(50).default([]),
  parentRunId: z.string().min(1).max(128).optional(),
});
export const completeRunSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  exitCode: z.number().int().min(0).max(255).optional(),
});

export const profileFileSchema = z.object({
  path: contextPathSchema,
  size: z.number().int().nonnegative(),
  storagePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
});

export const profileSchema = z.object({
  id: profileIdSchema,
  displayName: profileDisplayNameSchema,
  ownerId: z.string(),
  scope: z.enum(['personal', 'workspace']),
  workspaceSlug: workspaceSlugSchema.nullable(),
  inherits: z.array(profileIdSchema),
  currentVersion: z.number().int().positive(),
  files: z.array(profileFileSchema),
  serviceBindings: z.array(serviceBindingSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal(1),
});

export const bundleSchema = z.object({
  profile: profileSchema,
  resolvedProfiles: z.array(profileSchema),
  files: z.array(z.object({path: contextPathSchema, contentBase64: z.string()})),
  serviceCredentials: z.array(z.object({provider: serviceProviderSchema, connectionId: connectionIdSchema, environmentVariable: z.string(), secret: z.string()})).default([]),
});

export const workspaceSchema = z.object({
  id: workspaceSlugSchema,
  displayName: workspaceDisplayNameSchema,
  ownerId: z.string(),
  role: workspaceRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workspaceMemberSchema = z.object({
  uid: z.string(),
  email: z.string().email().nullable(),
  role: workspaceRoleSchema,
  createdAt: z.string(),
});

export const workspaceInviteSchema = z.object({
  id: z.string(),
  workspaceSlug: workspaceSlugSchema,
  email: z.string().email(),
  role: manageableWorkspaceRoleSchema,
  invitedBy: z.string(),
  createdAt: z.string(),
});

export const runSchema = z.object({
  id: z.string(),
  profileId: profileIdSchema,
  profileReference: profileReferenceSchema,
  profileDisplayName: profileDisplayNameSchema,
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
export type Connection = z.infer<typeof connectionSchema>;
export type ProfileFile = z.infer<typeof profileFileSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type ManageableWorkspaceRole = z.infer<typeof manageableWorkspaceRoleSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;
export type Run = z.infer<typeof runSchema>;
