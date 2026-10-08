import {
  Config,
  Context,
  Effect,
  flow,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Semaphore,
} from "effect";
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import { AUTHORING_GUIDE_ID } from "../docs.js";
import { download } from "../http-client.js";
import {
  type Assignment,
  type DisplayQuery,
  type FrameworkContext,
  ListOf,
  Model,
  OneOf,
  Playlist,
  type PlaylistInput,
  SafeDevice,
  Screen,
  type ScreenFilters,
  type ScreenInput,
  type ScreenRef,
  type ScreenUpdate,
  TerminusError,
  Tokens,
} from "./contracts.js";

const maximumImageBytes = 10 * 1024 * 1024;

// Only the origin and path are kept, so credentials in the URL would be dropped silently.
const terminusUrl = Schema.URL.check(
  Schema.makeFilter(({ protocol }) => protocol === "http:" || protocol === "https:", {
    message: "TERMINUS_URL must use HTTP or HTTPS",
  }),
  Schema.makeFilter(({ username, password }) => !username && !password, {
    message: "TERMINUS_URL must not contain credentials",
  }),
);

/** TERMINUS_URL, TERMINUS_LOGIN and TERMINUS_PASSWORD; the URL's query and fragment are dropped. */
export const terminusConfig = Config.all({
  baseUrl: Config.schema(terminusUrl, "TERMINUS_URL").pipe(
    Config.map((url) => `${url.origin}${url.pathname}`),
  ),
  login: Config.NonEmptyString("TERMINUS_LOGIN"),
  password: Config.NonEmptyString("TERMINUS_PASSWORD").pipe(Config.map(Redacted.make)),
});

const fail = (message: string) => Effect.fail(new TerminusError({ message }));

const unexpected = fail("Terminus returned an unexpected response.");

/**
 * Every failure of one exchange as a TerminusError: a refusal names `refused`, its status and
 * the detail Terminus gave, and the exchange times out after a minute.
 */
const exchange =
  (refused: string) =>
  <A, R>(
    effect: Effect.Effect<
      A,
      TerminusError | HttpClientError.HttpClientError | Schema.SchemaError,
      R
    >,
  ) =>
    effect.pipe(
      Effect.catchTag("HttpClientError", ({ reason }) => {
        switch (reason._tag) {
          case "StatusCodeError":
            return reason.response.text.pipe(
              Effect.orElseSucceed(() => ""),
              Effect.flatMap((text) =>
                fail(`${refused} (HTTP ${reason.response.status})${detail(text)}`),
              ),
            );
          case "DecodeError":
          case "EmptyBodyError":
            return unexpected;
          default:
            return fail("Unable to reach Terminus.");
        }
      }),
      Effect.catchTag("SchemaError", () => unexpected),
      Effect.timeoutOrElse({
        duration: "60 seconds",
        orElse: () => fail("Terminus request timed out."),
      }),
    );

const json =
  <S extends Schema.Constraint & { readonly DecodingServices: never }>(schema: S) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    );

const make = Effect.gen(function* () {
  const { baseUrl, login: user, password } = yield* terminusConfig;
  // Uploads are fetched by absolute URL, without the access token.
  const uploads = yield* HttpClient.HttpClient;
  const http = uploads.pipe(
    HttpClient.mapRequest(
      flow(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.acceptJson),
    ),
  );

  const tokens = yield* Ref.make(Option.none<typeof Tokens.Type>());
  const renewal = yield* Semaphore.make(1);

  const login = http
    .execute(
      HttpClientRequest.post("login").pipe(
        HttpClientRequest.bodyJsonUnsafe({ login: user, password: Redacted.value(password) }),
      ),
    )
    .pipe(Effect.flatMap(json(Tokens)), exchange("Terminus login failed"));

  // A refresh Terminus refuses, or that fails at all, falls back to a new login.
  const refresh = (current: typeof Tokens.Type) =>
    http
      .execute(
        HttpClientRequest.post("api/jwt").pipe(
          HttpClientRequest.setHeader("Authorization", current.access_token),
          HttpClientRequest.bodyJsonUnsafe({ refresh_token: current.refresh_token }),
        ),
      )
      .pipe(
        Effect.flatMap(json(Tokens)),
        exchange("Terminus token refresh failed"),
        Effect.catch(() => login),
      );

  // One renewal at a time: a caller that waited finds the token another one renewed.
  const renew = (failedToken: string | undefined) =>
    renewal.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(tokens);
        if (Option.isSome(current) && current.value.access_token !== failedToken) {
          return current.value;
        }
        const renewed = yield* Option.match(current, { onNone: () => login, onSome: refresh });
        yield* Ref.set(tokens, Option.some(renewed));
        return renewed;
      }),
    );

  const accessToken = Ref.get(tokens).pipe(
    Effect.flatMap(Option.match({ onNone: () => renew(undefined), onSome: Effect.succeed })),
    Effect.map(({ access_token }) => access_token),
  );

  /** A request with the current token, retried once with a renewed one if Terminus says it expired. */
  const api = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: S,
    body?: unknown,
  ) => {
    const send = (token: string) => {
      const request = HttpClientRequest.make(method)(path).pipe(
        HttpClientRequest.setHeader("Authorization", token),
      );
      return http.execute(
        body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body),
      );
    };

    return Effect.gen(function* () {
      const token = yield* accessToken;
      const response = yield* send(token);
      const expired =
        response.status === 401 ||
        (response.status === 400 && (yield* response.text).includes("expired JWT access token"));
      return yield* json(schema)(
        expired ? yield* send((yield* renew(token)).access_token) : response,
      );
    }).pipe(exchange("Terminus request failed"));
  };

  const devices = api("GET", "api/devices", ListOf(SafeDevice));
  const models = api("GET", "api/models", ListOf(Model));
  const playlists = api("GET", "api/playlists", ListOf(Playlist)).pipe(
    Effect.map(({ data }) => data),
  );

  const listScreens = (filters: ScreenFilters) =>
    api("GET", "api/screens", ListOf(Screen)).pipe(
      Effect.map(({ data }) => {
        const query = filters.query?.toLocaleLowerCase();
        return {
          screens: data.filter(
            (screen) =>
              (filters.model_id === undefined || screen.model_id === filters.model_id) &&
              (query === undefined ||
                screen.name.toLocaleLowerCase().includes(query) ||
                screen.label.toLocaleLowerCase().includes(query)),
          ),
        };
      }),
    );

  const getDisplayContext = Effect.fn("Terminus.getDisplayContext")(function* ({
    device_id: deviceId,
  }: DisplayQuery) {
    const [{ data: allDevices }, { data: allModels }, allPlaylists] = yield* Effect.all(
      [devices, models, playlists],
      { concurrency: "unbounded" },
    );

    const device =
      deviceId === undefined
        ? yield* onlyDevice(allDevices)
        : allDevices.find((candidate) => candidate.id === deviceId);
    if (!device) return yield* fail(`Device ${deviceId} was not found.`);

    const model = allModels.find((candidate) => candidate.id === device.model_id);
    if (!model) {
      return yield* fail(`Model ${device.model_id} for device ${device.id} was not found.`);
    }

    return {
      context: {
        device,
        model,
        playlist: allPlaylists.find((candidate) => candidate.id === device.playlist_id) ?? null,
        framework: frameworkContext(model),
      },
    };
  });

  const getScreenImage = Effect.fn("Terminus.getScreenImage")(function* ({
    screen_id: screenId,
  }: ScreenRef) {
    const { screens } = yield* listScreens({});
    const screen = screens.find(({ id }) => id === screenId);
    if (!screen) return yield* fail(`Screen ${screenId} was not found.`);

    const url = new URL(screen.uri, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/uploads/")) {
      return yield* fail("Terminus returned an unsafe screen image URL.");
    }

    const { type, body } = yield* uploads.execute(HttpClientRequest.get(url)).pipe(
      Effect.flatMap((response) =>
        download(response, (type) => type.startsWith("image/"), maximumImageBytes),
      ),
      Effect.catchTag("Unacceptable", ({ reason }) =>
        fail(
          reason === "type"
            ? "Terminus returned a non-image screen attachment."
            : "The screen image exceeds the 10 MiB limit.",
        ),
      ),
      exchange("Screen image fetch failed"),
    );
    return { screen, image: { data: body, mimeType: type } };
  });

  const createScreen = Effect.fn("Terminus.createScreen")(function* (input: ScreenInput) {
    if (
      input.playlist_id !== undefined &&
      !(yield* playlists).some(({ id }) => id === input.playlist_id)
    ) {
      return yield* fail(`Playlist ${input.playlist_id} was not found.`);
    }

    const { html, ...screen } = input;
    const { data } = yield* api("POST", "api/screens", OneOf(Screen), {
      screen: { ...screen, content: html },
    });
    return { screen: data };
  });

  const updateScreen = Effect.fn("Terminus.updateScreen")(function* (input: ScreenUpdate) {
    const { screen_id: screenId, html, label, mode } = input;
    const { data } = yield* api("PATCH", `api/screens/${screenId}`, OneOf(Screen), {
      screen: { label, mode, content: html },
    });
    return { screen: data };
  });

  const savePlaylist = Effect.fn("Terminus.savePlaylist")(function* (input: PlaylistInput) {
    const all = yield* playlists;
    const playlist =
      input.playlist_id === undefined
        ? yield* playlistByName(all, input.name)
        : all.find(({ id }) => id === input.playlist_id);

    if (input.playlist_id !== undefined && !playlist) {
      return yield* fail(`Playlist ${input.playlist_id} was not found.`);
    }

    const payload = {
      playlist: {
        name: input.name,
        label: input.label,
        mode: input.mode ?? playlist?.mode ?? "automatic",
        items: input.screen_ids.map((screen_id) => ({ screen_id })),
      },
    };

    if (!playlist) {
      const { data } = yield* api("POST", "api/playlists", OneOf(Playlist), payload);
      return { action: "created" as const, playlist: data };
    }

    const path = `api/playlists/${playlist.id}`;
    const { data } = yield* api("PATCH", path, OneOf(Playlist), payload);
    const firstItem = data.items[0];
    if (!firstItem) return { action: "updated" as const, playlist: data };

    const { data: selected } = yield* api("PATCH", path, OneOf(Playlist), {
      playlist: { name: data.name, label: data.label, current_item_id: firstItem.id },
    });
    return { action: "updated" as const, playlist: selected };
  });

  const assignPlaylist = Effect.fn("Terminus.assignPlaylist")(function* ({
    device_id: deviceId,
    playlist_id,
  }: Assignment) {
    const { data } = yield* api("PATCH", `api/devices/${deviceId}`, OneOf(SafeDevice), {
      device: { playlist_id },
    });
    return { device: data };
  });

  // Each method takes its action's input and answers with its success.
  return {
    getDisplayContext,
    listScreens,
    getScreenImage,
    listPlaylists: () => Effect.map(playlists, (all) => ({ playlists: all })),
    createScreen,
    updateScreen,
    savePlaylist,
    assignPlaylist,
  };
});

/** The Terminus account TERMINUS_URL, TERMINUS_LOGIN and TERMINUS_PASSWORD name. */
export class Terminus extends Context.Service<Terminus>()("terminus-mcp/Terminus", { make }) {
  static readonly layer = Layer.effect(Terminus, Terminus.make);
}

/** The detail a refusal gives, as JSON `detail` or `error` or as plain text, if it is short. */
function detail(text: string): string {
  let found = text;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const candidate = parsed.detail ?? parsed.error;
    found = typeof candidate === "string" ? candidate : "";
  } catch {}
  return found && found.length <= 300 ? `: ${found}` : "";
}

function onlyDevice(devices: ReadonlyArray<SafeDevice>) {
  if (devices.length === 1) return Effect.succeed(devices[0]!);
  if (devices.length === 0) return fail("No Terminus devices were found.");

  const choices = devices.map(({ id, label }) => ({ device_id: id, label }));
  return fail(
    `Multiple Terminus devices were found; provide device_id explicitly. Available devices: ${JSON.stringify(choices)}`,
  );
}

function playlistByName(playlists: ReadonlyArray<Playlist>, name: string) {
  const matches = playlists.filter((playlist) => playlist.name === name);
  if (matches.length > 1) {
    return fail(`Multiple playlists have the name ${JSON.stringify(name)}.`);
  }
  return Effect.succeed(matches[0]);
}

function frameworkContext(model: Model): FrameworkContext {
  const configuredClasses = Object.values(model.css.classes);

  return {
    css_url: "https://trmnl.com/css/latest/plugins.css",
    javascript_url: "https://trmnl.com/js/latest/plugins.js",
    screen_classes: [
      ...new Set([
        "screen",
        ...configuredClasses,
        `screen--${model.bit_depth}bit`,
        model.width >= model.height ? "screen--landscape" : "screen--portrait",
      ]),
    ],
    screen_variables: Object.fromEntries(model.css.variables),
    authoring_guide_id: AUTHORING_GUIDE_ID,
  };
}
