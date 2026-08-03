import { z } from "zod";

import {
  authSchema,
  listOf,
  modelSchema,
  oneOf,
  playlistSchema,
  safeDeviceSchema,
  screenSchema,
  type DisplayContext,
  type FrameworkContext,
  type Model,
  type Playlist,
  type PlaylistInput,
  type SafeDevice,
  type SavedPlaylist,
  type Screen,
  type ScreenInput,
  type ScreenUpdate,
} from "./contracts.js";

interface TerminusClientOptions {
  baseUrl: string;
  login: string;
  password: string;
  fetcher?: typeof fetch;
}

export class TerminusClient {
  readonly baseUrl: URL;
  private readonly loginName: string;
  private readonly password: string;
  private readonly fetcher: typeof fetch;
  private accessToken?: string;
  private refreshToken?: string;
  private renewal: Promise<void> | undefined;

  constructor({ baseUrl, login, password, fetcher = fetch }: TerminusClientOptions) {
    if (!baseUrl) throw new Error("TERMINUS_URL is required.");
    const url = new URL(baseUrl);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("TERMINUS_URL must use HTTP or HTTPS.");
    }
    if (url.username || url.password) {
      throw new Error("TERMINUS_URL must not contain credentials.");
    }
    if (!login) throw new Error("TERMINUS_LOGIN is required.");
    if (!password) throw new Error("TERMINUS_PASSWORD is required.");

    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";

    this.baseUrl = url;
    this.loginName = login;
    this.password = password;
    this.fetcher = fetcher;
  }

  static fromEnv(environment: NodeJS.ProcessEnv = process.env): TerminusClient {
    return new TerminusClient({
      baseUrl: environment.TERMINUS_URL ?? "",
      login: environment.TERMINUS_LOGIN ?? "",
      password: environment.TERMINUS_PASSWORD ?? "",
    });
  }

  async getDisplayContext(deviceId?: number): Promise<DisplayContext> {
    const [devices, models, playlists] = await Promise.all([
      this.listDevices(),
      this.listModels(),
      this.listPlaylists(),
    ]);

    const device =
      deviceId === undefined
        ? this.onlyDevice(devices)
        : devices.find((candidate) => candidate.id === deviceId);

    if (!device) throw new Error(`Device ${deviceId} was not found.`);

    const model = models.find((candidate) => candidate.id === device.model_id);
    if (!model) {
      throw new Error(`Model ${device.model_id} for device ${device.id} was not found.`);
    }

    const playlist = playlists.find((candidate) => candidate.id === device.playlist_id) ?? null;

    return {
      device,
      model,
      playlist,
      framework: frameworkContext(model),
    };
  }

  async listModels(): Promise<Model[]> {
    return this.request("/api/models", listOf(modelSchema)).then(({ data }) => data);
  }

  async listScreens(
    filters: {
      model_id?: number | undefined;
      query?: string | undefined;
    } = {},
  ): Promise<Screen[]> {
    const { data } = await this.request("/api/screens", listOf(screenSchema));
    const query = filters.query?.toLocaleLowerCase();

    return data.filter(
      (screen) =>
        (filters.model_id === undefined || screen.model_id === filters.model_id) &&
        (query === undefined ||
          screen.name.toLocaleLowerCase().includes(query) ||
          screen.label.toLocaleLowerCase().includes(query)),
    );
  }

  async getScreenImage(screenId: number) {
    const screen = (await this.listScreens()).find(({ id }) => id === screenId);
    if (!screen) throw new Error(`Screen ${screenId} was not found.`);

    const url = new URL(screen.uri, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith("/uploads/")) {
      throw new Error("Terminus returned an unsafe screen image URL.");
    }

    const response = await this.fetch(url);
    if (!response.ok) throw await this.responseError(response, "Screen image fetch failed");

    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (!mimeType?.startsWith("image/")) {
      throw new Error("Terminus returned a non-image screen attachment.");
    }

    const maximumBytes = 10 * 1024 * 1024;
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
      throw new Error("The screen image exceeds the 10 MiB limit.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error("The screen image exceeds the 10 MiB limit.");
    }

    return { screen, data: bytes.toString("base64"), mimeType };
  }

  async listPlaylists(): Promise<Playlist[]> {
    return this.request("/api/playlists", listOf(playlistSchema)).then(({ data }) => data);
  }

  async createScreen(input: ScreenInput): Promise<Screen> {
    if (
      input.playlist_id !== undefined &&
      !(await this.listPlaylists()).some(({ id }) => id === input.playlist_id)
    ) {
      throw new Error(`Playlist ${input.playlist_id} was not found.`);
    }

    const { html, ...screen } = input;

    return this.request("/api/screens", oneOf(screenSchema), {
      method: "POST",
      body: JSON.stringify({ screen: { ...screen, content: html } }),
    }).then(({ data }) => data);
  }

  async updateScreen(input: ScreenUpdate): Promise<Screen> {
    const { screen_id: screenId, html, label, mode } = input;

    return this.request(`/api/screens/${screenId}`, oneOf(screenSchema), {
      method: "PATCH",
      body: JSON.stringify({ screen: { label, mode, content: html } }),
    }).then(({ data }) => data);
  }

  async savePlaylist(input: PlaylistInput): Promise<SavedPlaylist> {
    const playlists = await this.listPlaylists();
    const playlist = input.playlist_id
      ? playlists.find(({ id }) => id === input.playlist_id)
      : this.playlistByName(playlists, input.name);

    if (input.playlist_id && !playlist) {
      throw new Error(`Playlist ${input.playlist_id} was not found.`);
    }

    const payload = {
      playlist: {
        name: input.name,
        label: input.label,
        mode: input.mode ?? playlist?.mode ?? "automatic",
        items: input.screen_ids.map((screen_id) => ({ screen_id })),
      },
    };

    if (playlist) {
      const { data } = await this.request(`/api/playlists/${playlist.id}`, oneOf(playlistSchema), {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const firstItem = data.items[0];
      if (!firstItem) return { action: "updated", playlist: data };

      const { data: selected } = await this.request(
        `/api/playlists/${playlist.id}`,
        oneOf(playlistSchema),
        {
          method: "PATCH",
          body: JSON.stringify({
            playlist: {
              name: data.name,
              label: data.label,
              current_item_id: firstItem.id,
            },
          }),
        },
      );
      return { action: "updated", playlist: selected };
    }

    const { data } = await this.request("/api/playlists", oneOf(playlistSchema), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { action: "created", playlist: data };
  }

  async assignPlaylist(deviceId: number, playlistId: number): Promise<SafeDevice> {
    const { data } = await this.request(`/api/devices/${deviceId}`, oneOf(safeDeviceSchema), {
      method: "PATCH",
      body: JSON.stringify({ device: { playlist_id: playlistId } }),
    });

    return data;
  }

  private async listDevices(): Promise<SafeDevice[]> {
    return this.request("/api/devices", listOf(safeDeviceSchema)).then(({ data }) => data);
  }

  private onlyDevice(devices: SafeDevice[]): SafeDevice {
    if (devices.length === 1) return devices[0]!;
    if (devices.length === 0) throw new Error("No Terminus devices were found.");

    const choices = devices.map(({ id, label }) => ({ device_id: id, label }));
    throw new Error(
      `Multiple Terminus devices were found; provide device_id explicitly. Available devices: ${JSON.stringify(choices)}`,
    );
  }

  private playlistByName(playlists: Playlist[], name: string): Playlist | undefined {
    const matches = playlists.filter((playlist) => playlist.name === name);
    if (matches.length > 1) {
      throw new Error(`Multiple playlists have the name ${JSON.stringify(name)}.`);
    }
    return matches[0];
  }

  private async request<T extends z.ZodType>(
    path: string,
    schema: T,
    init: RequestInit = {},
  ): Promise<z.infer<T>> {
    const token = await this.getAccessToken();
    let response = await this.authorizedFetch(path, token, init);

    const tokenExpired =
      response.status === 401 ||
      (response.status === 400 &&
        (await response.clone().text()).includes("expired JWT access token"));
    if (tokenExpired) {
      await this.renew(token);
      response = await this.authorizedFetch(path, await this.getAccessToken(), init);
    }

    if (!response.ok) throw await this.responseError(response, "Terminus request failed");

    const body = await this.json(response, "Terminus returned invalid JSON.");
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error("Terminus returned an unexpected response.");
    }
    return parsed.data;
  }

  private async authorizedFetch(path: string, token: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", token);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");

    return this.fetch(new URL(path.replace(/^\//, ""), this.baseUrl), {
      ...init,
      headers,
    });
  }

  private async getAccessToken(): Promise<string> {
    if (!this.accessToken) await this.renew();
    return this.accessToken!;
  }

  private async renew(failedToken?: string): Promise<void> {
    if (failedToken && this.accessToken && failedToken !== this.accessToken) return;

    if (!this.renewal) {
      this.renewal = this.refreshOrLogin().finally(() => {
        this.renewal = undefined;
      });
    }

    await this.renewal;
  }

  private async refreshOrLogin(): Promise<void> {
    if (this.accessToken && this.refreshToken) {
      const response = await this.fetch(new URL("api/jwt", this.baseUrl), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: this.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });

      if (response.ok) {
        this.setTokens(authSchema.parse(await this.json(response, "Invalid JWT response.")));
        return;
      }
    }

    const response = await this.fetch(new URL("login", this.baseUrl), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ login: this.loginName, password: this.password }),
    });

    if (!response.ok) throw await this.responseError(response, "Terminus login failed");
    this.setTokens(authSchema.parse(await this.json(response, "Invalid login response.")));
  }

  private setTokens(tokens: z.infer<typeof authSchema>): void {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
  }

  private async fetch(url: URL, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.fetcher(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "Terminus request timed out."
          : "Unable to reach Terminus.";
      throw new Error(message);
    }
  }

  private async json(response: Response, errorMessage: string): Promise<unknown> {
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new Error(errorMessage);
    }
  }

  private async responseError(response: Response, prefix: string): Promise<Error> {
    const body = await response.text();
    let detail = "";

    try {
      const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
      const candidate = parsed.detail ?? parsed.error;
      if (typeof candidate === "string") detail = candidate;
    } catch {
      if (body && body.length <= 300) detail = body;
    }

    const suffix = detail ? `: ${detail}` : "";
    return new Error(`${prefix} (HTTP ${response.status})${suffix}`);
  }
}

function frameworkContext(model: Model): FrameworkContext {
  const configuredClasses = Object.values(model.css.classes);
  const screenVariables = Object.fromEntries(model.css.variables);

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
    screen_variables: screenVariables,
    authoring_guide_id: "terminus:screen-authoring",
  };
}
