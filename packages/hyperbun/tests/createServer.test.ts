import { afterEach, describe, expect, test } from "bun:test";
import path from "path";
import { createServer, html, json } from "../src/index";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) {
      await server.stop(true);
    }
  }
});

function track(server: ReturnType<typeof createServer>) {
  servers.push(server);
  return server;
}

describe("createServer", () => {
  test("handles simple route returning html", async () => {
    const server = track(
      createServer({
        port: 0,
        routes: {
          "/": () => html("<h1>Hello HyperBun</h1>"),
        },
      }),
    );

    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Hello HyperBun");
  });

  test("method table enforces 405 and allow header", async () => {
    const server = track(
      createServer({
        port: 0,
        routes: {
          "/resource": {
            GET: () => json({ ok: true }),
          },
        },
      }),
    );

    const getRes = await fetch(`http://127.0.0.1:${server.port}/resource`);
    expect(getRes.status).toBe(200);

    const postRes = await fetch(`http://127.0.0.1:${server.port}/resource`, {
      method: "POST",
    });

    expect(postRes.status).toBe(405);
    expect(postRes.headers.get("allow")).toBe("GET");
  });

  test("serves static directory with index fallback", async () => {
    const server = track(
      createServer({
        port: 0,
        static: {
          dir: path.resolve(import.meta.dir, "./fixtures/public"),
        },
      }),
    );

    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Static Fixture");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("onError hook customises failure responses", async () => {
    const server = track(
      createServer({
        port: 0,
        routes: {
          "/boom": () => {
            throw new Error("boom");
          },
        },
        onError: (error, ctx) => {
          expect(error).toBeInstanceOf(Error);
          expect(ctx.url.pathname).toBe("/boom");
          return json({ message: "handled" }, { status: 555 });
        },
      }),
    );

    const res = await fetch(`http://127.0.0.1:${server.port}/boom`);
    const body = await res.json();

    expect(res.status).toBe(555);
    expect(body).toEqual({ message: "handled" });
  });
});
