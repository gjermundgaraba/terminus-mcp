import { Effect, Option, Schema, SchemaTransformation } from "effect";

import { AUTHORING_GUIDE_ID } from "../docs.js";

export class TerminusError extends Schema.TaggedError<TerminusError>()("TerminusError", {
  message: Schema.String,
}) {}

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Finite);

/** A model's CSS, or none when Terminus has none or sends it in an unexpected shape. */
const ModelCss = Schema.Struct({
  classes: Schema.Record(Schema.String, Schema.String),
  variables: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
}).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some({ classes: {}, variables: [] }))));

export const SafeDevice = Schema.Struct({
  id: PositiveInt,
  model_id: PositiveInt,
  playlist_id: Schema.NullOr(PositiveInt),
  label: Schema.String,
  firmware_version: NullableString,
  wifi_band: NullableNumber,
  wifi_signal: NullableNumber,
  battery_charge: NullableNumber,
  battery_voltage: NullableNumber,
  charging: Schema.Boolean,
  refresh_rate: PositiveInt,
  image_cached: Schema.Boolean,
  synced_at: NullableString,
  width: NonNegativeInt,
  height: NonNegativeInt,
});

export const Model = Schema.Struct({
  id: PositiveInt,
  default_palette_id: Schema.NullOr(PositiveInt),
  name: Schema.String,
  label: Schema.String,
  description: NullableString,
  kind: Schema.String,
  mime_type: Schema.String,
  colors: PositiveInt,
  bit_depth: PositiveInt,
  rotation: Schema.Int,
  offset_x: Schema.Int,
  offset_y: Schema.Int,
  scale_factor: Schema.Finite.check(Schema.isGreaterThan(0)),
  css: ModelCss,
  width: NonNegativeInt,
  height: NonNegativeInt,
  created_at: Schema.String,
  updated_at: Schema.String,
});

export const Screen = Schema.Struct({
  id: PositiveInt,
  model_id: PositiveInt,
  label: Schema.String,
  name: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  filename: Schema.String,
  mime_type: Schema.String,
  bit_depth: PositiveInt,
  width: PositiveInt,
  height: PositiveInt,
  size: NonNegativeInt,
  uri: Schema.String,
});

const PlaylistItem = Schema.Struct({
  id: PositiveInt,
  screen_id: PositiveInt,
  position: PositiveInt,
  created_at: Schema.String,
  updated_at: Schema.String,
});

const PlaylistMode = Schema.Literals(["automatic", "manual"]);

export const Playlist = Schema.Struct({
  id: PositiveInt,
  name: Schema.String,
  label: Schema.String,
  current_item_id: Schema.NullOr(PositiveInt),
  mode: PlaylistMode,
  created_at: Schema.String,
  updated_at: Schema.String,
  items: Schema.Array(PlaylistItem),
});

export const Tokens = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
});

export const FrameworkContext = Schema.Struct({
  css_url: Schema.String,
  javascript_url: Schema.String,
  screen_classes: Schema.Array(Schema.String),
  screen_variables: Schema.Record(Schema.String, Schema.String),
  authoring_guide_id: Schema.Literal(AUTHORING_GUIDE_ID),
});

export const DisplayContext = Schema.Struct({
  device: SafeDevice,
  model: Model,
  playlist: Schema.NullOr(Playlist),
  framework: FrameworkContext,
});

export const SavedPlaylist = Schema.Struct({
  action: Schema.Literals(["created", "updated"]),
  playlist: Playlist,
});

const shortText = [Schema.isMinLength(1), Schema.isMaxLength(255)] as const;

/** Trimmed, and bounded on both sides, so the tool's input schema lists the bounds too. */
export const ShortText = Schema.String.check(...shortText).pipe(
  Schema.decodeTo(Schema.Trimmed.check(...shortText), SchemaTransformation.trim()),
);
const Html = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_000_000));
const ScreenMode = Schema.optionalKey(
  Schema.Literal("dither").annotate({
    description: "Use dither for photos or image-heavy content; omit it for text and UI.",
  }),
);

export const DisplayQuery = Schema.Struct({ device_id: Schema.optionalKey(PositiveInt) });

export const ScreenRef = Schema.Struct({ screen_id: PositiveInt });

export const Assignment = Schema.Struct({ device_id: PositiveInt, playlist_id: PositiveInt });

export const ScreenFilters = Schema.Struct({
  model_id: Schema.optionalKey(PositiveInt),
  query: Schema.optionalKey(ShortText),
});

export const ScreenInput = Schema.Struct({
  model_id: PositiveInt,
  label: ShortText,
  name: ShortText,
  html: Html,
  playlist_id: Schema.optionalKey(PositiveInt),
  mode: ScreenMode,
});

export const ScreenUpdate = Schema.Struct({
  screen_id: PositiveInt,
  html: Html,
  label: Schema.optionalKey(ShortText),
  mode: ScreenMode,
});

export const PlaylistInput = Schema.Struct({
  playlist_id: Schema.optionalKey(PositiveInt),
  name: ShortText,
  label: ShortText,
  mode: Schema.optionalKey(PlaylistMode),
  screen_ids: Schema.Array(PositiveInt).check(Schema.isMaxLength(1_000)),
});

export const ListOf = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ data: Schema.Array(item) });
export const OneOf = <S extends Schema.Top>(item: S) => Schema.Struct({ data: item });

export type Model = typeof Model.Type;
export type Playlist = typeof Playlist.Type;
export type SafeDevice = typeof SafeDevice.Type;
export type FrameworkContext = typeof FrameworkContext.Type;
export type DisplayQuery = typeof DisplayQuery.Type;
export type ScreenRef = typeof ScreenRef.Type;
export type Assignment = typeof Assignment.Type;
export type ScreenFilters = typeof ScreenFilters.Type;
export type ScreenInput = typeof ScreenInput.Type;
export type ScreenUpdate = typeof ScreenUpdate.Type;
export type PlaylistInput = typeof PlaylistInput.Type;
