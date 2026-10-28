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
  SchemaTransformation,
  Semaphore,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { HttpClientError } from "effect/http";

import { AUTHORING_GUIDE_ID } from "../docs.js";
import { download } from "../http-client.js";
import {
  Extension,
  ListOf,
  Model,
  OneOf,
  OneOrMissing,
  Playlist,
  SafeDevice,
  Screen,
  TerminusError,
  TerminusExchange,
  Tokens,
} from "./contracts.js";
import type {
  Assignment,
  DisplayQuery,
  ExchangeInput,
  ExchangeRef,
  ExchangeUpdate,
  ExtensionInput,
  ExtensionRef,
  ExtensionUpdate,
  FrameworkContext,
  PlaylistInput,
  PlaylistRef,
  ScreenFilters,
  ScreenInput,
  ScreenRef,
  ScreenUpdate,
} from "./contracts.js";

const maximumImageBytes = 10 * 1024 * 1024;

interface Payload {
  readonly [field: string]: Payload | Schema.Json | undefined;
}

const terminusBaseUrl = Schema.URL.check(
  Schema.makeFilter(
    ({ protocol }) => protocol === "http:" || protocol === "https:",
    {
      message: "TERMINUS_URL must use HTTP or HTTPS",
    }
  ),
  Schema.makeFilter(({ username, password }) => !username && !password, {
    message: "TERMINUS_URL must not contain credentials",
  })
).pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (url: URL) => `${url.origin}${url.pathname}`,
      encode: (baseUrl: string) => new URL(baseUrl),
    })
  )
);

export const terminusConfig = Config.all({
  baseUrl: Config.schema(terminusBaseUrl, "TERMINUS_URL"),
  login: Config.NonEmptyString("TERMINUS_LOGIN"),
  password: Config.NonEmptyString("TERMINUS_PASSWORD").pipe(
    Config.map(Redacted.make)
  ),
});

const fail = (message: string) => Effect.fail(new TerminusError({ message }));

const unexpected = fail("Terminus returned an unexpected response.");

const decodeProblem = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      detail: Schema.optionalKey(Schema.String),
      error: Schema.optionalKey(Schema.String),
      errors: Schema.optionalKey(Schema.Json),
    })
  )
);

const detail = (text: string): string => {
  const found = Option.match(decodeProblem(text), {
    onNone: () => "",
    onSome: ({ detail: given, error, errors }) =>
      [
        given ?? error,
        errors === undefined ? undefined : JSON.stringify(errors),
      ]
        .filter(Boolean)
        .join(" "),
  });

  if (!found) {
    return "";
  }

  return `: ${found.length > 500 ? `${found.slice(0, 499)}…` : found}`;
};

const redacted = ({ headers, ...exchange }: typeof TerminusExchange.Type) => ({
  ...exchange,
  header_names: Object.keys(headers ?? {}),
});

const onlyDevice = (devices: readonly SafeDevice[]) => {
  const [device] = devices;

  if (device === undefined) {
    return fail("No Terminus devices were found.");
  }

  if (devices.length === 1) {
    return Effect.succeed(device);
  }

  const choices = devices.map(({ id, label }) => ({ device_id: id, label }));

  return fail(
    `Multiple Terminus devices were found; provide device_id explicitly. Available devices: ${JSON.stringify(choices)}`
  );
};

const playlistByName = (playlists: readonly Playlist[], name: string) => {
  const matches = playlists.filter((playlist) => playlist.name === name);

  if (matches.length > 1) {
    return fail(`Multiple playlists have the name ${JSON.stringify(name)}.`);
  }

  return Effect.succeed(matches[0]);
};

const frameworkContext = (model: Model): FrameworkContext => {
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
};

const extensionPath = (id: number) => `api/extensions/${id}`;

const asTerminusError =
  (refused: string) =>
  <A, R>(
    effect: Effect.Effect<
      A,
      TerminusError | HttpClientError.HttpClientError | Schema.SchemaError,
      R
    >
  ) =>
    effect.pipe(
      Effect.catchReasons(
        "HttpClientError",
        {
          StatusCodeError: ({ response }) =>
            response.text.pipe(
              Effect.orElseSucceed(() => ""),
              Effect.flatMap((text) =>
                fail(`${refused} (HTTP ${response.status})${detail(text)}`)
              )
            ),
          DecodeError: () => unexpected,
          EmptyBodyError: () => unexpected,
        },
        () => fail("Unable to reach Terminus.")
      ),
      Effect.catchTag("SchemaError", () => unexpected),
      Effect.timeoutOrElse({
        duration: "60 seconds",
        orElse: () => fail("Terminus request timed out."),
      })
    );

const json =
  <S extends Schema.Constraint & { readonly DecodingServices: never }>(
    schema: S
  ) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema))
    );

const make = Effect.gen(function* () {
  const { baseUrl, login: user, password } = yield* terminusConfig;
  const unauthenticatedHttp = yield* HttpClient.HttpClient;

  const http = unauthenticatedHttp.pipe(
    HttpClient.mapRequest(
      flow(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.acceptJson)
    )
  );

  const tokens = yield* Ref.make(Option.none<typeof Tokens.Type>());
  const renewal = yield* Semaphore.make(1);

  const login = http
    .execute(
      HttpClientRequest.post("login").pipe(
        HttpClientRequest.bodyJsonUnsafe({
          login: user,
          password: Redacted.value(password),
        })
      )
    )
    .pipe(
      Effect.flatMap(json(Tokens)),
      asTerminusError("Terminus login failed")
    );

  const refresh = (current: typeof Tokens.Type) =>
    http
      .execute(
        HttpClientRequest.post("api/jwt").pipe(
          HttpClientRequest.setHeader("Authorization", current.access_token),
          HttpClientRequest.bodyJsonUnsafe({
            refresh_token: current.refresh_token,
          })
        )
      )
      .pipe(
        Effect.flatMap(json(Tokens)),
        asTerminusError("Terminus token refresh failed"),
        Effect.catch(() => login)
      );

  const renewUnlessAlreadyRenewed = (failedToken: string | undefined) =>
    renewal.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(tokens);

        if (
          Option.isSome(current) &&
          current.value.access_token !== failedToken
        ) {
          return current.value;
        }

        const renewed = yield* Option.match(current, {
          onNone: () => login,
          onSome: refresh,
        });

        yield* Ref.set(tokens, Option.some(renewed));

        return renewed;
      })
    );

  const accessToken = Ref.get(tokens).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => renewUnlessAlreadyRenewed(undefined),
        onSome: Effect.succeed,
      })
    ),
    Effect.map(({ access_token }) => access_token)
  );

  const respond = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Payload
  ) => {
    const send = (token: string) => {
      const request = HttpClientRequest.make(method)(path).pipe(
        HttpClientRequest.setHeader("Authorization", token)
      );

      return http.execute(
        body === undefined
          ? request
          : HttpClientRequest.bodyJsonUnsafe(request, body)
      );
    };

    return Effect.gen(function* () {
      const token = yield* accessToken;
      const response = yield* send(token);

      const expired =
        response.status === 401 ||
        (response.status === 400 &&
          (yield* response.text).includes("expired JWT access token"));

      return expired
        ? yield* send((yield* renewUnlessAlreadyRenewed(token)).access_token)
        : response;
    });
  };

  const api = <
    S extends Schema.Constraint & { readonly DecodingServices: never },
  >(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    schema: S,
    body?: Payload
  ) =>
    respond(method, path, body).pipe(
      Effect.flatMap(json(schema)),
      asTerminusError("Terminus request failed")
    );

  const one = <A>(
    method: "GET" | "PATCH" | "DELETE",
    path: string,
    item: Schema.Codec<A, unknown>,
    what: string,
    body?: Payload
  ) =>
    respond(method, path, body).pipe(
      Effect.flatMap((response) =>
        response.status === 404
          ? Effect.succeed(null)
          : json(OneOrMissing(item))(response)
      ),
      asTerminusError("Terminus request failed"),
      Effect.flatMap((found) =>
        found === null
          ? fail(`${what} was not found.`)
          : Effect.succeed(found.data)
      )
    );

  const devices = api("GET", "api/devices", ListOf(SafeDevice));
  const models = api("GET", "api/models", ListOf(Model));

  const playlists = api("GET", "api/playlists", ListOf(Playlist)).pipe(
    Effect.map(({ data }) => data)
  );

  const listScreens = (filters: ScreenFilters) =>
    api("GET", "api/screens", ListOf(Screen)).pipe(
      Effect.map(({ data }) => {
        const query = filters.query?.toLocaleLowerCase();

        return {
          screens: data.filter(
            (screen) =>
              (filters.model_id === undefined ||
                screen.model_id === filters.model_id) &&
              (query === undefined ||
                screen.name.toLocaleLowerCase().includes(query) ||
                screen.label.toLocaleLowerCase().includes(query))
          ),
        };
      })
    );

  const getDisplayContext = Effect.fn("Terminus.getDisplayContext")(function* ({
    device_id: deviceId,
  }: DisplayQuery) {
    const [{ data: allDevices }, { data: allModels }, allPlaylists] =
      yield* Effect.all([devices, models, playlists], {
        concurrency: "unbounded",
      });

    const device =
      deviceId === undefined
        ? yield* onlyDevice(allDevices)
        : allDevices.find((candidate) => candidate.id === deviceId);

    if (!device) {
      return yield* fail(`Device ${deviceId} was not found.`);
    }

    const model = allModels.find(
      (candidate) => candidate.id === device.model_id
    );

    if (!model) {
      return yield* fail(
        `Model ${device.model_id} for device ${device.id} was not found.`
      );
    }

    return {
      context: {
        device,
        model,
        playlist:
          allPlaylists.find(
            (candidate) => candidate.id === device.playlist_id
          ) ?? null,
        framework: frameworkContext(model),
      },
    };
  });

  const getScreenImage = Effect.fn("Terminus.getScreenImage")(function* ({
    screen_id: screenId,
  }: ScreenRef) {
    const screen = yield* one(
      "GET",
      `api/screens/${screenId}`,
      Screen,
      `Screen ${screenId}`
    );

    const url = new URL(screen.uri, baseUrl);

    if (
      url.origin !== new URL(baseUrl).origin ||
      !url.pathname.startsWith("/uploads/")
    ) {
      return yield* fail("Terminus returned an unsafe screen image URL.");
    }

    const { type, body } = yield* unauthenticatedHttp
      .execute(HttpClientRequest.get(url))
      .pipe(
        Effect.flatMap((response) =>
          download(
            response,
            (contentType) => contentType.startsWith("image/"),
            maximumImageBytes
          )
        ),
        Effect.catchTag("Unacceptable", ({ reason }) =>
          fail(
            reason === "type"
              ? "Terminus returned a non-image screen attachment."
              : "The screen image exceeds the 10 MiB limit."
          )
        ),
        asTerminusError("Screen image fetch failed")
      );

    return { screen, image: { data: body, mimeType: type } };
  });

  const createScreen = Effect.fn("Terminus.createScreen")(function* (
    input: ScreenInput
  ) {
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

  const updateScreen = Effect.fn("Terminus.updateScreen")(function* (
    input: ScreenUpdate
  ) {
    const { screen_id: screenId, html, label, mode } = input;

    const { data } = yield* api(
      "PATCH",
      `api/screens/${screenId}`,
      OneOf(Screen),
      {
        screen: { label, mode, content: html },
      }
    );

    return { screen: data };
  });

  const deleteScreen = Effect.fn("Terminus.deleteScreen")(function* ({
    screen_id: screenId,
  }: ScreenRef) {
    const path = `api/screens/${screenId}`;

    return { screen: yield* one("DELETE", path, Screen, `Screen ${screenId}`) };
  });

  const savePlaylist = Effect.fn("Terminus.savePlaylist")(function* (
    input: PlaylistInput
  ) {
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
      const { data } = yield* api(
        "POST",
        "api/playlists",
        OneOf(Playlist),
        payload
      );

      return { action: "created" as const, playlist: data };
    }

    const path = `api/playlists/${playlist.id}`;
    const { data } = yield* api("PATCH", path, OneOf(Playlist), payload);
    const [firstItem] = data.items;

    if (!firstItem) {
      return { action: "updated" as const, playlist: data };
    }

    const { data: selected } = yield* api("PATCH", path, OneOf(Playlist), {
      playlist: {
        name: data.name,
        label: data.label,
        current_item_id: firstItem.id,
      },
    });

    return { action: "updated" as const, playlist: selected };
  });

  const deletePlaylist = Effect.fn("Terminus.deletePlaylist")(function* ({
    playlist_id: playlistId,
  }: PlaylistRef) {
    const path = `api/playlists/${playlistId}`;

    return {
      playlist: yield* one("DELETE", path, Playlist, `Playlist ${playlistId}`),
    };
  });

  const assignPlaylist = Effect.fn("Terminus.assignPlaylist")(function* ({
    device_id: deviceId,
    playlist_id,
  }: Assignment) {
    const { data } = yield* api(
      "PATCH",
      `api/devices/${deviceId}`,
      OneOf(SafeDevice),
      {
        device: { playlist_id },
      }
    );

    return { device: data };
  });

  const oneExtension = (
    method: "GET" | "PATCH" | "DELETE",
    id: number,
    body?: Payload
  ) => one(method, extensionPath(id), Extension, `Extension ${id}`, body);

  const oneExchange = (
    method: "PATCH" | "DELETE",
    { extension_id, exchange_id }: ExchangeRef,
    body?: Payload
  ) =>
    one(
      method,
      `${extensionPath(extension_id)}/exchanges/${exchange_id}`,
      TerminusExchange,
      `Exchange ${exchange_id} of extension ${extension_id}`,
      body
    ).pipe(Effect.map(redacted));

  const listExtensions = api("GET", "api/extensions", ListOf(Extension)).pipe(
    Effect.map(({ data }) => ({ extensions: data }))
  );

  const getExtension = Effect.fn("Terminus.getExtension")(function* ({
    extension_id: extensionId,
  }: ExtensionRef) {
    const extension = yield* oneExtension("GET", extensionId);
    const path = `${extensionPath(extensionId)}/exchanges`;

    const { data: exchanges } = yield* api(
      "GET",
      path,
      ListOf(TerminusExchange)
    );

    return { extension, exchanges: exchanges.map(redacted) };
  });

  const createExtension = Effect.fn("Terminus.createExtension")(function* (
    input: ExtensionInput
  ) {
    const { model_ids, device_ids, ...extension } = input;

    const { data } = yield* api("POST", "api/extensions", OneOf(Extension), {
      extension,
      model_ids,
      device_ids,
    });

    return { extension: data };
  });

  // Terminus clears the models and devices a patch omits, checks a schedule's interval and unit
  // only together, and refuses an empty extension, so each patch carries the current models,
  // devices and schedule unless the input replaces them.
  // https://github.com/usetrmnl/terminus/blob/0.78.0/app/aspects/extensions/updater.rb#L37-L38
  // https://github.com/usetrmnl/terminus/blob/0.78.0/app/contracts/rules/cron.rb#L10
  // https://github.com/usetrmnl/terminus/blob/0.78.0/app/contracts/api/extensions/patch.rb#L12
  const updateExtension = Effect.fn("Terminus.updateExtension")(function* (
    input: ExtensionUpdate
  ) {
    const {
      extension_id: extensionId,
      model_ids,
      device_ids,
      ...changes
    } = input;

    const current = yield* oneExtension("GET", extensionId);

    const extension = yield* oneExtension("PATCH", extensionId, {
      extension: {
        ...changes,
        interval: changes.interval ?? current.interval,
        unit: changes.unit ?? current.unit,
      },
      model_ids: model_ids ?? current.model_ids,
      device_ids: device_ids ?? current.device_ids,
    });

    return { extension };
  });

  const deleteExtension = Effect.fn("Terminus.deleteExtension")(function* ({
    extension_id: extensionId,
  }: ExtensionRef) {
    return { extension: yield* oneExtension("DELETE", extensionId) };
  });

  const createExchange = Effect.fn("Terminus.createExchange")(function* (
    input: ExchangeInput
  ) {
    const { extension_id: extensionId, ...exchange } = input;
    const path = `${extensionPath(extensionId)}/exchanges`;

    const { data } = yield* api("POST", path, OneOf(TerminusExchange), {
      exchange,
    });

    return { exchange: redacted(data) };
  });

  const updateExchange = Effect.fn("Terminus.updateExchange")(function* (
    input: ExchangeUpdate
  ) {
    const { extension_id, exchange_id, ...exchange } = input;

    return {
      exchange: yield* oneExchange(
        "PATCH",
        { extension_id, exchange_id },
        { exchange }
      ),
    };
  });

  const deleteExchange = Effect.fn("Terminus.deleteExchange")(function* (
    ref: ExchangeRef
  ) {
    return { exchange: yield* oneExchange("DELETE", ref) };
  });

  return {
    getDisplayContext,
    listScreens,
    getScreenImage,
    listPlaylists: Effect.map(playlists, (all) => ({ playlists: all })),
    createScreen,
    updateScreen,
    deleteScreen,
    savePlaylist,
    deletePlaylist,
    assignPlaylist,
    listExtensions,
    getExtension,
    createExtension,
    updateExtension,
    deleteExtension,
    createExchange,
    updateExchange,
    deleteExchange,
  };
});

export class Terminus extends Context.Service<Terminus>()(
  "terminus-mcp/Terminus",
  { make }
) {
  static readonly layer = Layer.effect(Terminus, Terminus.make);
}
