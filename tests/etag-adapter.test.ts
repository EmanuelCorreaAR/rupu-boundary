/**
 * Real adapter (rupu-boundary/etag) — fetch GET + PUT If-Match.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createEtagBoundary, type FetchLike } from "../src/adapters/etag.js";
import { resetVault } from "../src/testing.js";

function mockServer() {
  let body = "v1";
  let etag = '"1"';
  let seq = 1;
  let puts = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (n) =>
            n.toLowerCase() === "etag"
              ? etag
              : n.toLowerCase() === "content-type"
                ? "text/plain"
                : null,
        },
        text: async () => body,
      };
    }
    if (method === "PUT") {
      puts += 1;
      const ifMatch = init?.headers?.["If-Match"];
      if (ifMatch !== etag) {
        return {
          ok: false,
          status: 412,
          headers: { get: () => null },
          text: async () => "",
        };
      }
      body = init?.body ?? body;
      seq += 1;
      etag = `"${seq}"`;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "",
      };
    }
    throw new Error(`unexpected ${method}`);
  };

  return {
    fetchImpl,
    bump: () => {
      seq += 1;
      etag = `"${seq}"`;
    },
    puts: () => puts,
    body: () => body,
  };
}

describe("rupu-boundary/etag", () => {
  beforeEach(() => resetVault());

  it("prepare → commit publishes with If-Match", async () => {
    const server = mockServer();
    const boundary = createEtagBoundary({ fetch: server.fetchImpl });
    const p = boundary.propose({ url: "https://example.test/doc", body: "v2" });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");
    const result = await boundary.commit(prep.value);
    expect(result.ok).toBe(true);
    expect(server.puts()).toBe(1);
    expect(server.body()).toBe("v2");
  });

  it("external ETag change → Stale", async () => {
    const server = mockServer();
    const boundary = createEtagBoundary({ fetch: server.fetchImpl });
    const p = boundary.propose({ url: "https://example.test/doc", body: "v2" });
    if (!p.ok) return;
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) return;
    server.bump();
    const result = await boundary.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
    expect(server.puts()).toBe(0);
  });
});
