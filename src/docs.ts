import { readFile } from "node:fs/promises";

import { Context, Effect, Exit, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { download } from "./http-client.js";

export const AUTHORING_GUIDE_ID = "terminus:screen-authoring";

export class DocsError extends Schema.TaggedError<
  DocsError,
  { readonly brand: unique symbol }
>()("DocsError", {
  message: Schema.String,
}) {}

export const ScreenDoc = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  url: Schema.String,
  source: Schema.Literals(["Terminus MCP", "TRMNL Docs", "TRMNL Framework"]),
});

export type ScreenDoc = typeof ScreenDoc.Type;

const localDoc: ScreenDoc = {
  id: AUTHORING_GUIDE_ID,
  title: "Authoring screens through Terminus MCP",
  summary:
    "Required full-document format and the safe render-to-publish workflow.",
  url: "terminus-mcp://docs/screen-authoring",
  source: "Terminus MCP",
};

const trmnlOrigins = new Set(["https://trmnl.com", "https://docs.trmnl.com"]);

const trmnlEntryPoints = new Set([
  "private-plugins/templates",
  "private-plugins/templates-advanced",
]);

const trmnlPages = new Set([
  ...trmnlEntryPoints,
  "private-plugins/reusing-markup",
  "diy/imagemagick-guide",
]);

const frameworkEntryPoints = new Set([
  "structure",
  "screen",
  "layout",
  "framework_runtime",
]);

const fail = (message: string) => Effect.fail(new DocsError({ message }));

const matches = <F extends Schema.Struct.Fields>(
  input: string,
  pattern: RegExp,
  groups: Schema.Struct<F>
) =>
  Effect.forEach(input.matchAll(pattern), (match) =>
    Schema.decodeUnknownEffect(groups)(match.groups)
  ).pipe(Effect.orDie);

const Slug = Schema.Struct({ slug: Schema.String });

const uniqueSlugs = (input: string, pattern: RegExp) =>
  matches(input, pattern, Slug).pipe(
    Effect.map((found) => [...new Set(found.map(({ slug }) => slug))])
  );

const humanize = (slug: string): string =>
  slug
    .split("_")
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(" ");

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  const fetchText = (
    url: string,
    content: "html" | "markdown",
    maximumBytes: number
  ) => {
    if (!trmnlOrigins.has(new URL(url).origin)) {
      return fail(`Refused a documentation URL outside TRMNL: ${url}`);
    }

    const types =
      content === "html" ? ["text/html"] : ["text/markdown", "text/plain"];

    return http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.accept(types.join(", "))
        )
      )
      .pipe(
        Effect.flatMap((response) =>
          download(response, (type) => types.includes(type), maximumBytes)
        ),
        Effect.map(({ body }) => new TextDecoder().decode(body)),
        Effect.catchTags({
          Unacceptable: ({ reason }) =>
            fail(
              reason === "type"
                ? "TRMNL documentation returned an unexpected content type."
                : "TRMNL documentation exceeds the size limit."
            ),
          HttpClientError: ({ reason }) =>
            reason._tag === "StatusCodeError"
              ? fail(
                  `TRMNL documentation request failed (HTTP ${reason.response.status}).`
                )
              : fail("Unable to reach TRMNL documentation."),
        }),
        Effect.timeoutOrElse({
          duration: "15 seconds",
          orElse: () => fail("TRMNL documentation request timed out."),
        })
      );
  };

  const build = Effect.gen(function* () {
    const frameworkPage = yield* fetchText(
      "https://trmnl.com/framework",
      "html",
      1024 * 1024
    );

    const versions = (yield* matches(
      frameworkPage,
      /\/framework\/docs\/(?<version>\d+\.\d+)/gu,
      Schema.Struct({ version: Schema.String })
    )).map(({ version }) => version);

    const collator = new Intl.Collator("en", { numeric: true });

    const version = versions
      .toSorted((left, right) => collator.compare(left, right))
      .at(-1);

    if (version === undefined) {
      return yield* fail(
        "TRMNL Framework documentation version was not found."
      );
    }

    const [trmnlIndex, frameworkIndex, examplesIndex] = yield* Effect.all(
      [
        fetchText("https://docs.trmnl.com/go/llms.txt", "markdown", 256 * 1024),
        fetchText(
          `https://trmnl.com/framework/docs/${version}`,
          "html",
          1024 * 1024
        ),
        fetchText("https://trmnl.com/framework/examples", "html", 1024 * 1024),
      ],
      { concurrency: "unbounded" }
    );

    const trmnl = (yield* matches(
      trmnlIndex,
      /^- \[(?<title>[^\]]+)\]\(https:\/\/docs\.trmnl\.com\/go\/(?<path>[a-z0-9/_-]+)\.md\):\s*(?<summary>.+)$/gmu,
      Schema.Struct({
        title: Schema.String,
        path: Schema.String,
        summary: Schema.String,
      })
    ))
      .filter(({ path }) => trmnlPages.has(path))
      .map(({ title, path, summary }): ScreenDoc => ({
        id: `trmnl:${path}`,
        title,
        summary,
        url: `https://docs.trmnl.com/go/${path}.md`,
        source: "TRMNL Docs",
      }));

    const framework = (yield* uniqueSlugs(
      frameworkIndex,
      new RegExp(
        `/framework/docs/${version.replace(".", "\\.")}/(?<slug>[a-z0-9_-]+)`,
        "gu"
      )
    )).map((slug): ScreenDoc => ({
      id: `framework:${version}:${slug}`,
      title: humanize(slug),
      summary: `Official TRMNL Framework ${version} documentation for ${humanize(slug)}.`,
      url: `https://trmnl.com/framework/docs/${version}/${slug}.md`,
      source: "TRMNL Framework",
    }));

    const examples = (yield* uniqueSlugs(
      examplesIndex,
      /\/framework\/examples\/(?<slug>[a-z0-9_-]+)/gu
    )).map((slug): ScreenDoc => ({
      id: `framework-example:${slug}`,
      title: `${humanize(slug)} example`,
      summary: `Complete official TRMNL Framework example for ${humanize(slug)}.`,
      url: `https://trmnl.com/framework/examples/${slug}.md`,
      source: "TRMNL Framework",
    }));

    const all = [localDoc, ...trmnl, ...framework, ...examples];

    const entryPoints = new Set([
      localDoc.id,
      ...[...trmnlEntryPoints].map((path) => `trmnl:${path}`),
      ...[...frameworkEntryPoints].map(
        (slug) => `framework:${version}:${slug}`
      ),
    ]);

    return { all, entryPoints: all.filter(({ id }) => entryPoints.has(id)) };
  });

  const catalog = yield* Effect.cachedWithTTL(build, (exit) =>
    Exit.isSuccess(exit) ? "1 hour" : 0
  );

  const search = ({ query }: { readonly query?: string }) =>
    Effect.map(catalog, ({ all, entryPoints }) => {
      if (query === undefined || query === "") {
        return { docs: entryPoints };
      }

      const terms = query.toLocaleLowerCase().split(/\s+/u);

      return {
        docs: all.filter((doc) => {
          const text =
            `${doc.id} ${doc.title} ${doc.summary}`.toLocaleLowerCase();

          return terms.every((term) => text.includes(term));
        }),
      };
    });

  const read = Effect.fn("ScreenDocs.read")(function* ({
    doc_id: id,
  }: {
    readonly doc_id: string;
  }) {
    if (id === localDoc.id) {
      const markdown = yield* Effect.tryPromise({
        try: async () =>
          await readFile(
            new URL("../docs/screen-authoring.md", import.meta.url),
            "utf-8"
          ),
        catch: () =>
          new DocsError({
            message: "The screen authoring guide is unavailable.",
          }),
      });

      return { doc: localDoc, markdown };
    }

    const doc = (yield* catalog).all.find((candidate) => candidate.id === id);

    if (!doc) {
      return yield* fail(`Unknown screen documentation ID: ${id}`);
    }

    return { doc, markdown: yield* fetchText(doc.url, "markdown", 256 * 1024) };
  });

  return { search, read };
});

export class ScreenDocs extends Context.Service<ScreenDocs>()(
  "terminus-mcp/ScreenDocs",
  { make }
) {
  static readonly layer = Layer.effect(ScreenDocs, ScreenDocs.make);
}
