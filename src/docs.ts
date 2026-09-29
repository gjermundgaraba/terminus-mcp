import { readFile } from "node:fs/promises";

export interface ScreenDoc {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: "Terminus MCP" | "TRMNL Docs" | "TRMNL Framework";
}

const localDoc: ScreenDoc = {
  id: "terminus:screen-authoring",
  title: "Authoring screens through Terminus MCP",
  summary: "Required full-document format and the safe render-to-publish workflow.",
  url: "terminus-mcp://docs/screen-authoring",
  source: "Terminus MCP",
};

const trmnlPaths = new Set([
  "private-plugins/templates",
  "private-plugins/templates-advanced",
  "private-plugins/reusing-markup",
  "diy/imagemagick-guide",
]);

export class ScreenDocs {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async search(query?: string): Promise<ScreenDoc[]> {
    const catalog = await this.catalog();
    if (!query) {
      return catalog.filter(
        ({ id }) =>
          id === localDoc.id ||
          id === "trmnl:private-plugins/templates" ||
          id === "trmnl:private-plugins/templates-advanced" ||
          /^(framework:[^:]+:(structure|screen|layout|framework_runtime))$/.test(id),
      );
    }

    const terms = query.toLocaleLowerCase().split(/\s+/);
    return catalog.filter((doc) => {
      const text = `${doc.id} ${doc.title} ${doc.summary}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }

  async read(id: string): Promise<{ doc: ScreenDoc; markdown: string }> {
    if (id === localDoc.id) {
      return {
        doc: localDoc,
        markdown: await readFile(new URL("../docs/screen-authoring.md", import.meta.url), "utf8"),
      };
    }

    if (
      !/^(?:trmnl:[a-z0-9/_-]+|framework:\d+\.\d+:[a-z0-9_-]+|framework-example:[a-z0-9_-]+)$/.test(
        id,
      )
    ) {
      throw new Error(`Unknown screen documentation ID: ${id}`);
    }

    const doc = (await this.catalog()).find((candidate) => candidate.id === id);
    if (!doc) throw new Error(`Unknown screen documentation ID: ${id}`);

    return {
      doc,
      markdown: await this.fetchText(new URL(doc.url), "markdown", 256 * 1024),
    };
  }

  private async catalog(): Promise<ScreenDoc[]> {
    const frameworkPage = await this.fetchText(
      new URL("https://trmnl.com/framework"),
      "html",
      1024 * 1024,
    );
    const versions = [...frameworkPage.matchAll(/\/framework\/docs\/(\d+\.\d+)/g)].map(
      (match) => match[1]!,
    );
    const collator = new Intl.Collator("en", { numeric: true });
    const version = versions.sort((left, right) => collator.compare(left, right)).at(-1);
    if (!version) throw new Error("TRMNL Framework documentation version was not found.");

    const [trmnlIndex, frameworkIndex, examplesIndex] = await Promise.all([
      this.fetchText(new URL("https://docs.trmnl.com/go/llms.txt"), "markdown", 256 * 1024),
      this.fetchText(new URL(`https://trmnl.com/framework/docs/${version}`), "html", 1024 * 1024),
      this.fetchText(new URL("https://trmnl.com/framework/examples"), "html", 1024 * 1024),
    ]);

    const trmnl = [
      ...trmnlIndex.matchAll(
        /^- \[([^\]]+)\]\(https:\/\/docs\.trmnl\.com\/go\/([a-z0-9/_-]+)\.md\):\s*(.+)$/gm,
      ),
    ]
      .filter((match) => trmnlPaths.has(match[2]!))
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

    return [localDoc, ...trmnl, ...framework, ...examples];
  }

  private async fetchText(
    url: URL,
    content: "html" | "markdown",
    maximumBytes: number,
  ): Promise<string> {
    if (!isAllowed(url)) throw new Error("Unsafe TRMNL documentation URL.");

    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: {
          Accept: content === "html" ? "text/html" : "text/markdown, text/plain",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(
        error instanceof Error && error.name === "TimeoutError"
          ? "TRMNL documentation request timed out."
          : "Unable to reach TRMNL documentation.",
      );
    }

    if (!response.ok) {
      throw new Error(`TRMNL documentation request failed (HTTP ${response.status}).`);
    }

    const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    const allowedTypes =
      content === "html" ? new Set(["text/html"]) : new Set(["text/markdown", "text/plain"]);
    if (!type || !allowedTypes.has(type)) {
      throw new Error("TRMNL documentation returned an unexpected content type.");
    }

    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
      throw new Error("TRMNL documentation exceeds the size limit.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error("TRMNL documentation exceeds the size limit.");
    }
    return bytes.toString("utf8");
  }
}

function isAllowed(url: URL): boolean {
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return false;
  }

  return (
    (url.hostname === "docs.trmnl.com" &&
      (url.pathname === "/go/llms.txt" || /^\/go\/[a-z0-9/_-]+\.md$/.test(url.pathname))) ||
    (url.hostname === "trmnl.com" &&
      (url.pathname === "/framework" ||
        url.pathname === "/framework/examples" ||
        /^\/framework\/docs\/\d+\.\d+(?:\/[a-z0-9_-]+\.md)?$/.test(url.pathname) ||
        /^\/framework\/examples\/[a-z0-9_-]+\.md$/.test(url.pathname)))
  );
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
