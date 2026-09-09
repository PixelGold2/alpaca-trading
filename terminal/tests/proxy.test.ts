import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import proxy from "@/proxy";

function makeRequest(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `terminal_session=${cookie}`);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

describe("proxy (optimistic auth redirect)", () => {
  it("redirects to /login when no session cookie is present on a protected route", () => {
    const res = proxy(makeRequest("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows the request through when a session cookie is present", () => {
    const res = proxy(makeRequest("/", "some-token"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an already-authenticated user away from /login", () => {
    const res = proxy(makeRequest("/login", "some-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/");
  });

  it("allows an unauthenticated request to reach /login", () => {
    const res = proxy(makeRequest("/login"));
    expect(res.headers.get("location")).toBeNull();
  });
});
