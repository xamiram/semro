export const config = {
  runtime: "edge"
};

export default async function handler(req) {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime?.() || "N/A",
    service: "api-gateway",
    version: "2.1.0"
  };
  
  return new Response(JSON.stringify(health, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30"
    }
  });
}
