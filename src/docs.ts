import { readFile } from "node:fs/promises";

import { Context, Effect, Exit, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { download } from "./http-client.js";

/** The ID of the authoring guide this server ships, which agents read before writing a screen. */
export const AUTHORING_GUIDE_ID = "terminus:screen-authoring";

export class DocsError extends Schema.TaggedError<DocsError>()("DocsError", {
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
  summary: "Required full-document format and the safe render-to-publish workflow.",
  url: "terminus-mcp://docs/screen-authoring",
  source: "Terminus MCP",
};

/** The docs.trmnl.com pages in the catalog, and whether search lists each without a query. */
const trmnlPages = new Map([
  ["private-plugins/templates", true],
  ["private-plugins/templates-advanced", true],
  ["private-plugins/reusing-markup", false],
  ["diy/imagemagick-guide", false],
]);

/** The Framework pages search lists without a query, in whichever version is current. */
const frameworkEntryPoints = new Set(["structure", "screen", "layout", "framework_runtime"]);

const fail = (message: string) => Effect.fail(new DocsError({ message }));

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  const fetchText = (url: string, content: "html" | "markdown", maximumBytes: number) => {
    const types = content === "html" ? ["text/html"] : ["text/markdown", "text/plain"];
    return http
      .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.accept(types.join(", "))))
      .pipe(
        Effect.flatMap((response) =>
          download(response, (type) => types.includes(type), maximumBytes),
        ),
        Effect.map(({ body }) => new TextDecoder().decode(body)),
        Effect.catchTags({
          Unacceptable: ({ reason }) =>
            fail(
              reason === "type"
                ? "TRMNL documentation returned an unexpected content type."
                : "TRMNL documentation exceeds the size limit.",
            ),
          HttpClientError: ({ reason }) =>
            reason._tag === "StatusCodeError"
              ? fail(`TRMNL documentation request failed (HTTP ${reason.response.status}).`)
              : fail("Unable to reach TRMNL documentation."),
        }),
        Effect.timeoutOrElse({
          duration: "15 seconds",
          orElse: () => fail("TRMNL documentation request timed out."),
        }),
      );
  };

  // Every URL below is a constant, or one built from a slug of [a-z0-9_-], so it stays on TRMNL.
  const build = Effect.gen(function* () {
    const frameworkPage = yield* fetchText("https://trmnl.com/framework", "html", 1024 * 1024);
    const versions = [...frameworkPage.matchAll(/\/framework\/docs\/(\d+\.\d+)/g)].map(
      (match) => match[1]!,
    );
    const collator = new Intl.Collator("en", { numeric: true });
    const version = versions.sort((left, right) => collator.compare(left, right)).at(-1);
    if (!version) return yield* fail("TRMNL Framework documentation version was not found.");

    const [trmnlIndex, frameworkIndex, examplesIndex] = yield* Effect.all(
      [
        fetchText("https://docs.trmnl.com/go/llms.txt", "markdown", 256 * 1024),
        fetchText(`https://trmnl.com/framework/docs/${version}`, "html", 1024 * 1024),
        fetchText("https://trmnl.com/framework/examples", "html", 1024 * 1024),
      ],
      { concurrency: "unbounded" },
    );

    const trmnl = [
      ...trmnlIndex.matchAll(
        /^- \[([^\]]+)\]\(https:\/\/docs\.trmnl\.com\/go\/([a-z0-9/_-]+)\.md\):\s*(.+)$/gm,
      ),
    ]
      .filter((match) => trmnlPages.has(match[2]!))
      .map((match): ScreenDoc => ({
        id: `trmnl:${match[2]}`,
        title: match[1]!,
        summary: match[3]!,
        url: `https://docs.trmnl.com/go/${match[2]}.md`,
        source: "TRMNL Docs",
      }));

    const framework = uniqueMatches(
      frameworkIndex,
      new RegExp(`/framework/docs/${version.replace(".", "\\.")}/([a-z0-9_-]+)`, "g"),
    ).map((slug): ScreenDoc => ({
      id: `framework:${version}:${slug}`,
      title: humanize(slug),
      summary: `Official TRMNL Framework ${version} documentation for ${humanize(slug)}.`,
      url: `https://trmnl.com/framework/docs/${version}/${slug}.md`,
      source: "TRMNL Framework",
    }));

    const examples = uniqueMatches(examplesIndex, /\/framework\/examples\/([a-z0-9_-]+)/g).map(
      (slug): ScreenDoc => ({
        id: `framework-example:${slug}`,
        title: `${humanize(slug)} example`,
        summary: `Complete official TRMNL Framework example for ${humanize(slug)}.`,
        url: `https://trmnl.com/framework/examples/${slug}.md`,
        source: "TRMNL Framework",
      }),
    );

    const all = [localDoc, ...trmnl, ...framework, ...examples];
    const entryPoints = new Set([
      localDoc.id,
      ...[...trmnlPages].filter(([, listed]) => listed).map(([path]) => `trmnl:${path}`),
      ...[...frameworkEntryPoints].map((slug) => `framework:${version}:${slug}`),
    ]);
    return { all, entryPoints: all.filter(({ id }) => entryPoints.has(id)) };
  });
  // An hour of searches and reads share one catalog; a failed build is retried by the next one.
  const catalog = yield* Effect.cachedWithTTL(build, (exit) =>
    Exit.isSuccess(exit) ? "1 hour" : 0,
  );

  const search = ({ query }: { readonly query?: string }) =>
    Effect.map(catalog, ({ all, entryPoints }) => {
      if (!query) return { docs: entryPoints };
      const terms = query.toLocaleLowerCase().split(/\s+/);
      return {
        docs: all.filter((doc) => {
          const text = `${doc.id} ${doc.title} ${doc.summary}`.toLocaleLowerCase();
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
        try: () => readFile(new URL("../docs/screen-authoring.md", import.meta.url), "utf8"),
        catch: () => new DocsError({ message: "The screen authoring guide is unavailable." }),
      });
      return { doc: localDoc, markdown };
    }

    const doc = (yield* catalog).all.find((candidate) => candidate.id === id);
    if (!doc) return yield* fail(`Unknown screen documentation ID: ${id}`);

    return { doc, markdown: yield* fetchText(doc.url, "markdown", 256 * 1024) };
  });

  return { search, read };
});

/** The authoring guide, and the official TRMNL documentation it links to. */
export class ScreenDocs extends Context.Service<ScreenDocs>()("terminus-mcp/ScreenDocs", { make }) {
  static readonly layer = Layer.effect(ScreenDocs, ScreenDocs.make);
}

function uniqueMatches(input: string, expression: RegExp): string[] {
  return [...new Set([...input.matchAll(expression)].map((match) => match[1]!))];
}

function humanize(slug: string): string {
  return slug
    .split("_")
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(" ");
}
