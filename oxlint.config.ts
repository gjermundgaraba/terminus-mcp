// The shared Ultracite exceptions. Every Effect/Vite+ repository carries this block verbatim, so
// a grep finds every copy; only the test-block and assertion-function name lists vary. Each rule
// here conflicts with an Effect idiom or with a contract the code must keep. Changing the block
// needs maintainer approval, and changes every copy.
import { recommended as effect } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";
import type { DummyRuleMap, OxlintOverride } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

// The files Ultracite's vitest preset treats as tests, so its rules and these relaxations agree.
const testFiles = [
  "**/*.{test,spec,test-d,spec-d}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
  "**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
];

export const sharedRules: DummyRuleMap = {
  // Key order carries meaning: wire formats, hashes, CLI flags, tool schemas, UI order.
  "sort-keys": "off",
  // A module holds several tagged errors or services, which are classes.
  "max-classes-per-file": "off",
  // A loop awaits in order where order, back-pressure or one-at-a-time I/O matters.
  "no-await-in-loop": "off",
  // With `promise-function-async`, it forces `await Promise.resolve(x)` into thin async wrappers.
  "require-await": "off",
  // `return yield*` in a generator reads as an inconsistent return.
  "typescript/consistent-return": "off",
  // A module may call a function or class declared further down, and types are hoisted; a
  // value used before its declaration is still an error.
  "no-use-before-define": [
    "error",
    { classes: false, functions: false, ignoreTypeReferences: true },
  ],
  // Metrics, not defects: splitting to satisfy them scatters one decision across helpers.
  complexity: "off",
  "max-nested-callbacks": "off",
  // Hashes, file modes and binary formats are bitwise by nature.
  "no-bitwise": "off",
  // Effect modules are PascalCase (`Schema.ts`); everything else is kebab-case.
  "unicorn/filename-case": [
    "error",
    { cases: { kebabCase: true, pascalCase: true } },
  ],
  // Optional DTO fields belong in their construction expression.
  "anti-slop/no-conditional-empty-object-spread": "off",
  // Generators passed to Effect.gen and Effect.fn are named by their span, not the function.
  "func-names": ["error", "as-needed", { generators: "never" }],
  // A schema and its type share a name; tsc rejects real redeclarations.
  "no-redeclare": "off",
  // `Effect.catch` is not a promise chain.
  "promise/prefer-await-to-then": "off",
  // Effect handlers are typed functions, not error-first callbacks: the rule flags every
  // `Effect.catch((error) => ...)`, the name `unicorn/catch-error-name` demands.
  "promise/prefer-await-to-callbacks": "off",
  // `readonly string[]`, but `ReadonlyArray<Html | string>` over `readonly (Html | string)[]`.
  "typescript/array-type": [
    "error",
    { default: "array-simple", readonly: "array-simple" },
  ],
  // Effect's data-first `map(self, f)` and `filter(self, f)` take no thisArg.
  "unicorn/no-array-method-this-argument": "off",
  // Effect APIs take `undefined` as a value, as in `Deferred.succeed(done, undefined)`.
  "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
  // `Schema.TaggedError<X>()` builds an error class; it throws nothing.
  "unicorn/throw-new-error": "off",
  // Notices for every unstable Effect API bury the warnings that matter.
  "effecttsgo/unstable-api-usage": "off",
};

export const sharedTestOverride: OxlintOverride = {
  files: testFiles,
  // Naming the plugin lets the override reach its rules.
  plugins: ["vitest"],
  rules: {
    // `@effect/vitest`'s test functions are test blocks, and the repository's assertion helpers
    // (Foldkit's `scene`/`story` among them, where used) assert. List the names the repository uses.
    "vitest/no-standalone-expect": [
      "error",
      { additionalTestBlockFunctions: ["it.effect"] },
    ],
    "vitest/expect-expect": [
      "error",
      {
        additionalTestBlockFunctions: ["it.effect"],
        assertFunctionNames: ["expect", "expectTypeOf", "assert", "assert.*"],
      },
    ],
    // An `Effect.fn` export's runtime name is empty, so `describe(fn)` reports `<anonymous>`; the
    // rule also takes namespace imports for functions. Titles are strings.
    "vitest/prefer-describe-function-title": "off",
    // A test writes `find(...)!` for what it asserts exists.
    "typescript/no-non-null-assertion": "off",
    // Each value gets its own `expect`, with a message where the value alone would not explain a failure.
    "vitest/max-expects": "off",
    "vitest/valid-expect": ["error", { maxArgs: 2 }],
    // `toBe(true)` asserts a boolean; `toBeTruthy()` accepts any truthy value.
    "vitest/prefer-to-be-truthy": "off",
    "vitest/prefer-to-be-falsy": "off",
    // Tests feed hostile and literal input on purpose.
    "no-script-url": "off",
    "no-template-curly-in-string": "off",
    // Replaces Ultracite's `no-module-mocking`, which misses `vi` from `vite-plus/test`.
    "vitest/no-restricted-vi-methods": [
      "error",
      {
        doMock:
          "Replace dependencies through Layers or real interfaces, not module mocks.",
        mock: "Replace dependencies through Layers or real interfaces, not module mocks.",
      },
    ],
  },
};

export default defineConfig({
  // A Node server: no browser globals.
  env: { node: true },
  extends: [core, antiSlop, vitest, effect],
  ignorePatterns: core.ignorePatterns ?? [],
  jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: "deny",
    typeAware: true,
    typeCheck: true,
  },
  overrides: [sharedTestOverride],
  rules: {
    ...sharedRules,
    "vite-plus/prefer-vite-plus-imports": "error",
  },
});
