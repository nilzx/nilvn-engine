// @vitest-environment jsdom
// Feedback round three (2026-09-28, the plugin-heavy docs-only work 《潮汐钟》):
// the fixes for what its author hit — an effect handle that exposed the
// renderer, the chosen mark under choicefx, the config entry moving the path
// base, plugin theme tokens in [theme], stage verbs that threw into plugins,
// enablePlugin's result and retry, the menu / title page overflowing, panels
// over the ending page and into replays, an empty HUD frame and empty list items.
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import type { PluginManifest } from "@nilvn/core";
import {
  createEngine,
  MemorySaveStore,
  applyConfig,
  type Engine,
} from "../src/index";
import type {
  EnginePlugin,
  PluginContext,
  PluginLoader,
  StageObjectHandle,
} from "../src/types";

beforeAll(() => {
  (Element.prototype as unknown as { animate: () => unknown }).animate =
    () => ({ finished: Promise.resolve(), finish() {} });
});
afterEach(() => vi.unstubAllGlobals());

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5);
  if (!cond()) throw new Error("condition never held");
};
function engineWith(opts: Record<string, unknown> = {}): Engine {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return createEngine({
    container,
    textSpeed: 0,
    saveStore: new MemorySaveStore(),
    saves: { autosave: false },
    baseUrl: "http://g.test/",
    ...opts,
  });
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? "";
const messages = (e: Engine): string[] => e.diagnostics.map((d) => d.message);

describe("the plugin boundary", () => {
  it("an effect's handle carries its verbs and nothing of the renderer", async () => {
    let seen: StageObjectHandle | undefined;
    const e = engineWith({
      actors: {
        xi: { name: "Xi", sprites: "xi-{face}.png", defaultFace: "calm" },
      },
      plugins: [
        {
          id: "com.x.fx",
          permissions: ["stage.write"],
          effects: {
            peek: {
              appliesToKinds: ["character"],
              apply: (h: StageObjectHandle) => void (seen = h),
            },
          },
        },
      ],
    });
    e.loadSource("[char xi]\n[set go = 1]\nnarr: x\n");
    void e.start();
    await until(() => e.getVar("go") === 1);
    await e.applyEffect("peek", "character:xi", {});
    expect(seen).toBeDefined();
    expect(Object.getOwnPropertyNames(seen)).toEqual(["id", "kind"]);
    expect(
      (seen as unknown as Record<string, unknown>).renderer,
    ).toBeUndefined();
    expect(typeof seen!.get).toBe("function");
    e.destroy();
  });

  it("a stage verb called wrongly is a diagnostic, never an exception in the plugin", async () => {
    let ctx!: PluginContext;
    const e = engineWith({
      plugins: [
        {
          id: "com.x.orb",
          permissions: ["stage.write"],
          activate: (c: PluginContext) => void (ctx = c),
        },
      ],
    });
    e.loadSource("narr: x\n");
    await e.prepare();
    await expect(
      ctx.stage!.showSprite({ id: "orb" } as never, undefined as never),
    ).resolves.toBeUndefined();
    await expect(
      ctx.stage!.showSprite("orb", { frames: 1 } as never),
    ).resolves.toBeUndefined();
    expect(messages(e)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "stage.showSprite: the first argument is the sprite id",
        ),
        expect.stringContaining(
          "stage.showSprite: spec.url (the resolved sheet URL) is missing",
        ),
      ]),
    );
    expect(e.stage.root.querySelector(".nilvn-sprite")).toBeNull();
    e.destroy();
  });
});

describe("config and loading", () => {
  it("a config entry in a folder keeps paths, aliases and plugins resolving from the config directory", async () => {
    const files: Record<string, string> = {
      "http://g.test/nilvn.config.toml":
        '[game]\nentry = "story/a.nvn"\n[path]\n"@bg" = "assets/bg"\n',
      "http://g.test/story/a.nvn": "[label start]\nnarr: A\n",
    };
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const body = files[String(input)];
      return body === undefined
        ? new Response("nope", { status: 404 })
        : new Response(body, { status: 200 });
    });
    const e = engineWith();
    await e.loadConfig("nilvn.config.toml");
    expect(await e.prepare()).toBe(true);
    expect(e.baseUrl).toBe("http://g.test/");
    expect(e.resolve("@bg/sea.svg")).toBe("http://g.test/assets/bg/sea.svg");
    e.destroy();
  });

  it("a plugin's own tokens in the config's [theme] are not unknown (plugins queued first)", async () => {
    const id = "com.x.tide";
    const man: PluginManifest = {
      id,
      name: id,
      version: "1.0.0",
      entries: { engine: "bundled" },
      contributes: { themeTokens: [{ name: "tide-water", default: "#08f" }] },
    };
    const e = engineWith({ registry: [{ id }], manifests: [man] });
    applyConfig(e, {
      plugins: { use: [id] },
      theme: { "tide-water": "#2a8f95", "tide-bogus": "1" },
    });
    e.loadSource("narr: x\n");
    await e.prepare();
    expect(messages(e).filter((m) => m.includes("theme token"))).toEqual([
      expect.stringContaining('"tide-bogus"'),
    ]);
    e.destroy();
  });

  it("enablePlugin(path) resolves true once active, and retries a path that failed before", async () => {
    const id = "com.x.late";
    let ready = false;
    const loader: PluginLoader = {
      fetchManifest: () =>
        ready
          ? Promise.resolve({
              id,
              name: id,
              version: "1.0.0",
              entries: { engine: "./engine.js" },
            })
          : Promise.reject(new Error("Unexpected token <")),
      importModule: () =>
        Promise.resolve({ default: { id } satisfies EnginePlugin }),
    };
    const e = engineWith({ pluginLoader: loader });
    e.loadSource("narr: x\n");
    await e.prepare();
    expect(await e.enablePlugin("plugins/late/plugin.json")).toBe(false);
    expect(
      messages(e).some((m) =>
        m.includes("(http://g.test/plugins/late/plugin.json) failed to load"),
      ),
    ).toBe(true);
    ready = true;
    expect(await e.enablePlugin("plugins/late/plugin.json")).toBe(true);
    expect(e.missingPlugins).toEqual([]);
    e.disablePlugin(id);
    expect(await e.enablePlugin("plugins/late/plugin.json")).toBe(true); // by id now, no re-import
    e.destroy();
  });
});

describe("chrome", () => {
  it("the chosen mark is an element of its own (a choice effect keeps the ::after)", async () => {
    const e = engineWith();
    applyConfig(e, { choices: { chosenStyle: "mark" } });
    e.setGlobal("sys.chosen", ["a"]);
    e.loadSource("[choice A -> a]\n[choice B -> b]\n[label a]\n[label b]\n");
    void e.start();
    await until(
      () => e.stage.choicesEl.querySelectorAll(".nilvn-choice").length === 2,
    );
    const [a, b] = [...e.stage.choicesEl.querySelectorAll(".nilvn-choice")];
    expect(a!.querySelector(".nilvn-choice__mark")).not.toBeNull();
    expect(b!.querySelector(".nilvn-choice__mark")).toBeNull();
    e.destroy();
  });

  it("plugin menu items come before the replay exit; a long title page goes to two columns", async () => {
    const id = "com.x.book";
    const man: PluginManifest = {
      id,
      name: id,
      version: "1.0.0",
      entries: { engine: "bundled" },
      permissions: ["ui.screen"],
      contributes: {
        menuItems: [{ id: "m", label: "M" }],
        titleItems: ["t1", "t2", "t3", "t4", "t5"].map((t) => ({
          id: t,
          label: t,
        })),
      },
    };
    const book: EnginePlugin = {
      id,
      activate: (ctx) => {
        for (const t of ["t1", "t2", "t3", "t4", "t5"])
          ctx.screen!.titleItem(t, () => {});
        ctx.screen!.menuItem("m", () => {});
      },
    };
    const e = engineWith({ registry: [book], manifests: [man], use: [id] });
    e.loadSource("narr: x\n");
    await e.showTitle();
    const panel = e.stage.root.querySelector(".nilvn-menu__panel")!;
    const ids = [...panel.children].map(
      (c) => (c as HTMLElement).dataset.id ?? c.className,
    );
    expect(ids.indexOf(`${id}:m`)).toBeLessThan(
      ids.findIndex((c) => c.includes("--exit")),
    );
    await until(
      () =>
        e.stage.root.querySelectorAll(
          ".nilvn-screen--title .nilvn-screen__button",
        ).length > 5,
    );
    expect(
      e.stage.root.querySelector(".nilvn-screen__buttons--two"),
    ).not.toBeNull();
    e.destroy();
  });

  it("a panel shown by hand leaves with the ending page and does not follow into a replay", async () => {
    const e = engineWith();
    applyConfig(e, {
      ui: {
        trust: {
          kind: "hud",
          show: "manual",
          widgets: [{ type: "text", text: "Trust" }],
        },
      },
    });
    e.loadSource("[ui show trust]\nnarr: x\n[ending good]\n");
    void e.start();
    await until(() => text(e) === "x");
    const hud = e.stage.root.querySelector<HTMLElement>(".nilvn-ui")!;
    expect(hud.style.display).toBe("");
    e.stage.root.click();
    await until(() => e.session === "ending");
    expect(hud.style.display).toBe("none");
    e.destroy();
  });

  it("a HUD whose widgets are all hidden draws no frame; a list drops empty entries", async () => {
    const e = engineWith();
    applyConfig(e, {
      ui: {
        meter: {
          kind: "hud",
          widgets: [{ type: "text", text: "Trust", if: "met" }],
        },
        bag: {
          kind: "hud",
          anchor: "top-right",
          widgets: [{ type: "list", var: "items" }],
        },
      },
    });
    e.loadSource('[set met = false]\n[set items = "key,tea,"]\nnarr: x\n');
    void e.start();
    await until(() => text(e) === "x");
    const [meter, bag] = [
      ...e.stage.root.querySelectorAll<HTMLElement>(".nilvn-ui"),
    ];
    expect(meter!.style.display).toBe("none");
    expect(
      [...bag!.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["key", "tea"]);
    e.setVar("met", true);
    expect(meter!.style.display).toBe("");
    e.destroy();
  });
});
