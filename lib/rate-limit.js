// Simple in-memory rate limiter
const requests = new Map();

export function rateLimit(identifier, limit = 60, window = 60000) {
  const now = Date.now();
  const key = `${identifier}`;
  
  // Clean old entries
  if (requests.size > 10000) {
    const oldestAllowed = now - window;
    for (const [k, timestamps] of requests.entries()) {
      const filtered = timestamps.filter(t => t > oldestAllowed);
      if (filtered.length === 0) {
        requests.delete(k);
      } else {
        requests.set(k, filtered);
      }
    }
  }
  
  // Get current requests
  let timestamps = requests.get(key) || [];
  
  // Filter to current window
  timestamps = timestamps.filter(t => t > now - window);
  
  // Check limit
  if (timestamps.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: timestamps[0] + window
    };
  }
  
  // Add current request
  timestamps.push(now);
  requests.set(key, timestamps);
  
  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetAt: now + window
  };
}
