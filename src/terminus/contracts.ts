import { Effect, Option, Schema, SchemaTransformation, Struct } from "effect";

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

/** How Terminus answers with HTTP 200 for a missing resource: a 404 problem, or empty data. */
const MissingAnswer = Schema.Union([
  Schema.Struct({ status: Schema.Literal(404) }),
  Schema.Struct({ data: Schema.Record(Schema.String, Schema.Never) }),
]);

/** Any missing answer, as null. */
const Missing = MissingAnswer.pipe(
  Schema.decodeTo(
    Schema.Null,
    SchemaTransformation.transform<null, typeof MissingAnswer.Type>({
      decode: () => null,
      encode: () => ({ status: 404 }),
    }),
  ),
);

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

/** An extension as Terminus answers with it; kind, mode and unit as sent, for forward compatibility. */
export const Extension = Schema.Struct({
  id: PositiveInt,
  name: Schema.String,
  label: Schema.String,
  description: NullableString,
  kind: Schema.String,
  mode: Schema.String,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  static_body: Schema.Json,
  fields: Schema.Json,
  template: NullableString,
  data: Schema.Json,
  interval: Schema.Int,
  unit: Schema.String,
  days: Schema.NullOr(Schema.Array(Schema.String)),
  last_day_of_month: Schema.Boolean,
  start_at: NullableString,
  created_at: Schema.String,
  updated_at: Schema.String,
  model_ids: Schema.Array(PositiveInt),
  device_ids: Schema.Array(PositiveInt),
});

const exchangeFields = {
  id: PositiveInt,
  verb: Schema.String,
  template: Schema.String,
  body: Schema.Json,
  data: Schema.Json,
  errors: Schema.Json,
  refreshed_at: NullableString,
  created_at: Schema.String,
  updated_at: Schema.String,
};

/** An exchange as Terminus answers with it, header values included. */
export const TerminusExchange = Schema.Struct({
  ...exchangeFields,
  headers: Schema.NullOr(Schema.Record(Schema.String, Schema.Json)),
});

/** An exchange with its header names only, since header values are where credentials live. */
export const Exchange = Schema.Struct({
  ...exchangeFields,
  header_names: Schema.Array(Schema.String),
});

export const ExtensionDetail = Schema.Struct({
  extension: Extension,
  exchanges: Schema.Array(Exchange),
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
const LongText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_000_000));
const Mode = Schema.optionalKey(
  Schema.Literals(["text", "dither"]).annotate({
    description:
      "Use dither for photos or image-heavy content; text, the default, for text and UI.",
  }),
);

export const DisplayQuery = Schema.Struct({ device_id: Schema.optionalKey(PositiveInt) });

export const ScreenRef = Schema.Struct({ screen_id: PositiveInt });

export const PlaylistRef = Schema.Struct({ playlist_id: PositiveInt });

export const Assignment = Schema.Struct({ device_id: PositiveInt, playlist_id: PositiveInt });

export const ScreenFilters = Schema.Struct({
  model_id: Schema.optionalKey(PositiveInt),
  query: Schema.optionalKey(ShortText),
});

export const ScreenInput = Schema.Struct({
  model_id: PositiveInt,
  label: ShortText,
  name: ShortText,
  html: LongText,
  playlist_id: Schema.optionalKey(PositiveInt),
  mode: Mode,
});

export const ScreenUpdate = Schema.Struct({
  screen_id: PositiveInt,
  html: LongText,
  label: Schema.optionalKey(ShortText),
  mode: Mode,
});

export const PlaylistInput = Schema.Struct({
  playlist_id: Schema.optionalKey(PositiveInt),
  name: ShortText,
  label: ShortText,
  mode: Schema.optionalKey(PlaylistMode),
  screen_ids: Schema.Array(PositiveInt).check(Schema.isMaxLength(1_000)),
});

const ExtensionKind = Schema.Literals(["image", "poll", "static", "webhook"]).annotate({
  description:
    "static renders static_body as source_1; poll renders the data its exchanges fetch; " +
    "image renders its exchanges' URLs as images; webhook renders data, which " +
    "update_extension replaces.",
});
const Unit = Schema.Literals(["none", "minute", "hour", "day", "week", "month"]).annotate({
  description:
    "How often Terminus rebuilds the extension's screens; none never builds them. The " +
    "interval must be 0-59 for minutes, 0-23 for hours, 1-31 for days, 0-6 for weeks, " +
    "and 1-12 for months. Weeks build on the given days; months may build on their last " +
    "day instead.",
});
const Weekday = Schema.Literals([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

const extensionFields = {
  name: ShortText,
  label: ShortText,
  description: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(10_000)))),
  kind: ExtensionKind,
  mode: Mode,
  template: LongText.annotate({
    description:
      "A Liquid template for the body of the screen, not a complete HTML document. Read " +
      `${AUTHORING_GUIDE_ID} first.`,
  }),
  tags: Schema.optionalKey(Schema.Array(ShortText).check(Schema.isMaxLength(100))),
  static_body: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  fields: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(100))),
  data: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  interval: Schema.optionalKey(NonNegativeInt),
  unit: Schema.optionalKey(Unit),
  days: Schema.optionalKey(Schema.Array(Weekday).check(Schema.isMaxLength(7))),
  last_day_of_month: Schema.optionalKey(Schema.Boolean),
  start_at: Schema.optionalKey(
    ShortText.annotate({ description: "When the schedule starts, as an ISO 8601 date-time." }),
  ),
  model_ids: Schema.optionalKey(Schema.Array(PositiveInt).check(Schema.isMaxLength(100))),
  device_ids: Schema.optionalKey(
    Schema.Array(PositiveInt)
      .check(Schema.isMaxLength(100))
      .annotate({ description: "Build one screen per device instead of one per model." }),
  ),
};

export const ExtensionInput = Schema.Struct(extensionFields);

export const ExtensionRef = Schema.Struct({ extension_id: PositiveInt });

/** Any of an extension's fields; the ones creating it requires are optional. */
export const ExtensionUpdate = Schema.Struct({
  ...ExtensionRef.fields,
  ...Struct.mapPick(extensionFields, ["name", "label", "kind", "template"], Schema.optionalKey),
});

const exchangeInputFields = {
  template: LongText.annotate({
    description:
      "The URLs to fetch, one per line. Liquid is rendered in them, and in header and body " +
      "values, with the extension's context.",
  }),
  verb: Schema.optionalKey(Schema.Literals(["get", "post"])),
  headers: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.String)).annotate({
      description: "All request headers; their values are never returned.",
    }),
  ),
  body: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
};

export const ExchangeInput = Schema.Struct({
  extension_id: PositiveInt,
  ...exchangeInputFields,
});

export const ExchangeRef = Schema.Struct({ extension_id: PositiveInt, exchange_id: PositiveInt });

/** Any of an exchange's fields. */
export const ExchangeUpdate = Schema.Struct({
  ...ExchangeRef.fields,
  ...Struct.mapPick(exchangeInputFields, ["template"], Schema.optionalKey),
});

export const ListOf = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ data: Schema.Array(item) });
export const OneOf = <S extends Schema.Top>(item: S) => Schema.Struct({ data: item });
/** One `item`, or null if Terminus says it is missing. */
export const OneOrMissing = <S extends Schema.Top>(item: S) => Schema.Union([OneOf(item), Missing]);

export type Model = typeof Model.Type;
export type Playlist = typeof Playlist.Type;
export type SafeDevice = typeof SafeDevice.Type;
export type FrameworkContext = typeof FrameworkContext.Type;
export type DisplayQuery = typeof DisplayQuery.Type;
export type ScreenRef = typeof ScreenRef.Type;
export type PlaylistRef = typeof PlaylistRef.Type;
export type Assignment = typeof Assignment.Type;
export type ScreenFilters = typeof ScreenFilters.Type;
export type ScreenInput = typeof ScreenInput.Type;
export type ScreenUpdate = typeof ScreenUpdate.Type;
export type PlaylistInput = typeof PlaylistInput.Type;
export type Extension = typeof Extension.Type;
export type ExtensionInput = typeof ExtensionInput.Type;
export type ExtensionUpdate = typeof ExtensionUpdate.Type;
export type ExtensionRef = typeof ExtensionRef.Type;
export type ExchangeInput = typeof ExchangeInput.Type;
export type ExchangeUpdate = typeof ExchangeUpdate.Type;
export type ExchangeRef = typeof ExchangeRef.Type;
