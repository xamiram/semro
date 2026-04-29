export const config = {
  runtime: "edge",
  regions: ["iad1"]
};

import { rateLimit } from "../lib/rate-limit.js";

const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || "60", 10);
const ENABLE_LOGGING = process.env.ENABLE_LOGGING === "true";

// Headers to remove
const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Get client identifier for rate limiting
function getClientId(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  return (forwarded?.split(",")[0] || realIp || "unknown").trim();
}

export default async function handler(req) {
  const url = new URL(req.url);
  
  // Serve homepage
  if (url.pathname === "/" || url.pathname === "") {
    return Response.redirect(url.origin + "/index.html", 302);
  }
  
  // Health check bypass
  if (url.pathname === "/health") {
    return new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }
  
  // Check backend configuration
  if (!BACKEND_URL) {
    return new Response(
      JSON.stringify({ 
        error: "Service Unavailable",
        message: "Backend not configured"
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  
  // Rate limiting
  const clientId = getClientId(req);
  const rateLimitResult = rateLimit(clientId, RATE_LIMIT);
  
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        error: "Too Many Requests",
        message: "Rate limit exceeded",
        retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Limit": String(RATE_LIMIT),
          "X-RateLimit-Remaining": "0"
        }
      }
    );
  }
  
  try {
    // Build target URL
    const targetUrl = BACKEND_URL + url.pathname + url.search;
    
    // Prepare headers
    const headers = new Headers();
    let clientIp = clientId;
    
    for (const [key, value] of req.headers) {
      const lowerKey = key.toLowerCase();
      
      // Skip problematic headers
      if (STRIP_HEADERS.has(lowerKey)) continue;
      if (lowerKey.startsWith("x-vercel-")) continue;
      if (lowerKey.startsWith("x-forwarded")) continue;
      
      headers.set(key, value);
    }
    
    // Add forwarding headers
    if (clientIp && clientIp !== "unknown") {
      headers.set("X-Forwarded-For", clientIp);
      headers.set("X-Real-IP", clientIp);
    }
    
    // Add gateway signature
    headers.set("X-Gateway", "api-gateway/2.1");
    
    const method = req.method;
    const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
    
    // Make request with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    // Prepare response headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("server");
    responseHeaders.delete("x-powered-by");
    responseHeaders.set("X-Gateway", "api-gateway");
    responseHeaders.set("X-RateLimit-Limit", String(RATE_LIMIT));
    responseHeaders.set("X-RateLimit-Remaining", String(rateLimitResult.remaining));
    
    // Optional logging
    if (ENABLE_LOGGING) {
      console.log({
        method,
        path: url.pathname,
        status: response.status,
        client: clientIp
      });
    }
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
    
  } catch (err) {
    // Handle errors gracefully
    if (err.name === "AbortError") {
      return new Response(
        JSON.stringify({ error: "Gateway Timeout" }),
        {
          status: 504,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    
    if (ENABLE_LOGGING) {
      console.error("Gateway error:", err.message);
    }
    
    return new Response(
      JSON.stringify({ 
        error: "Bad Gateway",
        message: "Unable to reach backend service"
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
