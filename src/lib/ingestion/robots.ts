import type { RobotsCheckResult } from "./types";

interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

export function parseRobotsTxt(
  robotsTxt: string,
  url: string,
  userAgent: string
): RobotsCheckResult {
  const groups = parseGroups(robotsTxt);
  const path = new URL(url).pathname;

  const exactGroup = groups.find((g) =>
    g.userAgents.some((ua) => ua.toLowerCase() === userAgent.toLowerCase())
  );
  const wildcardGroup = groups.find((g) =>
    g.userAgents.some((ua) => ua === "*")
  );
  const group = exactGroup || wildcardGroup;

  if (!group) {
    return { allowed: true };
  }

  let bestMatch: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (path.startsWith(rule.path)) {
      if (!bestMatch || rule.path.length > bestMatch.path.length) {
        bestMatch = rule;
      }
    }
  }

  return {
    allowed: bestMatch ? bestMatch.allow : true,
    crawlDelay: group.crawlDelay,
  };
}

function parseGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (current && current.userAgents.length > 0 && current.rules.length > 0) {
        groups.push(current);
        current = null;
      }
      if (!current) {
        current = { userAgents: [], rules: [] };
      }
      current.userAgents.push(value);
    } else if (current) {
      if (directive === "disallow" && value) {
        current.rules.push({ path: value, allow: false });
      } else if (directive === "allow" && value) {
        current.rules.push({ path: value, allow: true });
      } else if (directive === "crawl-delay") {
        const delay = parseFloat(value);
        if (!isNaN(delay) && delay > 0) {
          current.crawlDelay = delay;
        }
      }
    }
  }

  if (current && current.userAgents.length > 0) {
    groups.push(current);
  }

  return groups;
}

export class RobotsCache {
  private cache = new Map<string, string>();

  set(domain: string, robotsTxt: string): void {
    this.cache.set(domain, robotsTxt);
  }

  has(domain: string): boolean {
    return this.cache.has(domain);
  }

  check(url: string, userAgent: string): RobotsCheckResult {
    const domain = new URL(url).hostname;
    const robotsTxt = this.cache.get(domain);
    if (robotsTxt === undefined) {
      return { allowed: true };
    }
    return parseRobotsTxt(robotsTxt, url, userAgent);
  }
}
