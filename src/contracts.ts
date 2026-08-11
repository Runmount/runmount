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
  currentVersion: z.number().int().positive(),
  files: z.array(profileFileSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal(1),
});

export const bundleSchema = z.object({
  profile: profileSchema,
  files: z.array(z.object({path: contextPathSchema, contentBase64: z.string()})),
});

export type Profile = z.infer<typeof profileSchema>;
