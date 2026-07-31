import { z } from "zod";

const positiveId = z.number().int().positive();
const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();
const modelCssSchema = z
  .object({
    classes: z.record(z.string(), z.string()).catch({}),
    variables: z.array(z.tuple([z.string(), z.string()])).catch([]),
  })
  .catch({ classes: {}, variables: [] });

export const safeDeviceSchema = z.object({
  id: positiveId,
  model_id: positiveId,
  playlist_id: positiveId.nullable(),
  label: z.string(),
  firmware_version: nullableString,
  wifi_band: nullableNumber,
  wifi_signal: nullableNumber,
  battery_charge: nullableNumber,
  battery_voltage: nullableNumber,
  charging: z.boolean(),
  refresh_rate: z.number().int().positive(),
  image_cached: z.boolean(),
  synced_at: nullableString,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

export const modelSchema = z.object({
  id: positiveId,
  default_palette_id: positiveId.nullable(),
  name: z.string(),
  label: z.string(),
  description: nullableString,
  kind: z.string(),
  mime_type: z.string(),
  colors: z.number().int().positive(),
  bit_depth: z.number().int().positive(),
  rotation: z.number().int(),
  offset_x: z.number().int(),
  offset_y: z.number().int(),
  scale_factor: z.number().positive(),
  css: modelCssSchema,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const screenSchema = z.object({
  id: positiveId,
  model_id: positiveId,
  label: z.string(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  bit_depth: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  uri: z.string(),
});

const playlistItemSchema = z.object({
  id: positiveId,
  screen_id: positiveId,
  position: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const playlistSchema = z.object({
  id: positiveId,
  name: z.string(),
  label: z.string(),
  current_item_id: positiveId.nullable(),
  mode: z.enum(["automatic", "manual"]),
  created_at: z.string(),
  updated_at: z.string(),
  items: z.array(playlistItemSchema),
});

export const authSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

const shortText = z.string().trim().min(1).max(255);
const html = z.string().min(1).max(1_000_000);
const screenMode = z
  .literal("dither")
  .optional()
  .describe("Use dither for photos or image-heavy content; omit it for text and UI.");

export const screenInputSchema = z.object({
  model_id: positiveId,
  label: shortText,
  name: shortText,
  html,
  playlist_id: positiveId.optional(),
  mode: screenMode,
});

export const screenUpdateSchema = z
  .object({
    screen_id: positiveId,
    html,
    label: shortText.optional(),
    mode: screenMode,
  })
  .strict();

export const playlistInputSchema = z.object({
  playlist_id: positiveId.optional(),
  name: shortText,
  label: shortText,
  mode: z.enum(["automatic", "manual"]).optional(),
  screen_ids: z.array(positiveId).max(1_000),
});

export const listOf = <T extends z.ZodType>(schema: T) => z.object({ data: z.array(schema) });
export const oneOf = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

export type Model = z.infer<typeof modelSchema>;
export type Screen = z.infer<typeof screenSchema>;
export type Playlist = z.infer<typeof playlistSchema>;
export type SafeDevice = z.infer<typeof safeDeviceSchema>;

export interface DisplayContext {
  device: SafeDevice;
  model: Model;
  playlist: Playlist | null;
  framework: FrameworkContext;
}

export interface FrameworkContext {
  css_url: string;
  javascript_url: string;
  screen_classes: string[];
  screen_variables: Record<string, string>;
  authoring_guide_id: "terminus:screen-authoring";
}

export type ScreenInput = z.infer<typeof screenInputSchema>;
export type ScreenUpdate = z.infer<typeof screenUpdateSchema>;
export type PlaylistInput = z.infer<typeof playlistInputSchema>;

export interface SavedPlaylist {
  action: "created" | "updated";
  playlist: Playlist;
}
