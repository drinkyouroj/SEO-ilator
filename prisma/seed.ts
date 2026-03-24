import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// ── Article templates across topic clusters ──

const articleTemplates = [
  // TypeScript cluster
  {
    url: "/blog/typescript-generics-guide",
    title: "A Complete Guide to TypeScript Generics",
    body: "TypeScript generics allow you to create reusable components that work with a variety of types rather than a single one. This guide covers generic functions, generic interfaces, generic classes, and constraints. Generics provide a way to capture the type a user provides so that the information is available later. They are a fundamental building block for creating flexible and type-safe libraries.",
  },
  {
    url: "/blog/typescript-utility-types",
    title: "Mastering TypeScript Utility Types",
    body: "TypeScript provides several utility types to facilitate common type transformations. Partial, Required, Readonly, Pick, Omit, Record, Exclude, Extract, and ReturnType are among the most useful. Understanding these utility types helps you write more expressive type annotations and reduce boilerplate in your TypeScript projects.",
  },
  {
    url: "/blog/typescript-strict-mode",
    title: "Why You Should Enable TypeScript Strict Mode",
    body: "TypeScript strict mode enables a set of compiler flags that catch more potential errors at compile time. These flags include strictNullChecks, noImplicitAny, strictFunctionTypes, and strictPropertyInitialization. Enabling strict mode from the start of a project prevents many common runtime errors and improves code quality across the entire codebase.",
  },
  // React cluster
  {
    url: "/blog/react-server-components",
    title: "Understanding React Server Components",
    body: "React Server Components represent a paradigm shift in how we build React applications. They render on the server and send minimal JavaScript to the client. This approach reduces bundle size, improves performance, and enables direct access to backend resources. Server Components work alongside client components to create a hybrid rendering model.",
  },
  {
    url: "/blog/react-hooks-patterns",
    title: "Advanced React Hooks Patterns",
    body: "React hooks have transformed how we write components. Beyond useState and useEffect, patterns like custom hooks, useReducer for complex state, useMemo and useCallback for optimization, and useRef for imperative access provide powerful tools. Understanding when and how to compose hooks is essential for building maintainable React applications.",
  },
  {
    url: "/blog/react-state-management",
    title: "React State Management in 2026",
    body: "State management in React has evolved significantly. While Redux remains popular, newer solutions like Zustand, Jotai, and the built-in React Context API offer simpler alternatives for many use cases. Server state libraries like TanStack Query handle async data fetching with caching and synchronization built in. Choosing the right solution depends on your application complexity.",
  },
  // Next.js cluster
  {
    url: "/blog/nextjs-app-router",
    title: "Migrating to Next.js App Router",
    body: "The Next.js App Router introduces a new paradigm for building applications with React Server Components, nested layouts, and streaming. Migration from the Pages Router requires understanding the new file conventions, data fetching patterns, and how server and client components interact. This guide walks through a step-by-step migration strategy.",
  },
  {
    url: "/blog/nextjs-performance",
    title: "Next.js Performance Optimization Techniques",
    body: "Optimizing performance in Next.js involves leveraging built-in features like Image Optimization, Font Optimization, and Script Loading strategies. Server-side rendering, static generation, and incremental static regeneration each have performance tradeoffs. Measuring Core Web Vitals and using the built-in analytics helps identify bottlenecks in your Next.js application.",
  },
  {
    url: "/blog/nextjs-api-routes",
    title: "Building REST APIs with Next.js Route Handlers",
    body: "Next.js Route Handlers provide a powerful way to build API endpoints alongside your frontend. They support standard HTTP methods, streaming responses, and middleware patterns. Route handlers in the App Router use the Web Request and Response APIs, making them familiar to developers who have worked with modern web standards.",
  },
  // CSS cluster
  {
    url: "/blog/css-container-queries",
    title: "CSS Container Queries: A Practical Guide",
    body: "CSS container queries allow you to style elements based on the size of their container rather than the viewport. This enables truly modular components that adapt to their context. Container queries use the @container rule and require defining containment contexts on parent elements. They complement media queries for responsive design.",
  },
  {
    url: "/blog/tailwind-best-practices",
    title: "Tailwind CSS Best Practices for Large Projects",
    body: "Tailwind CSS scales well in large projects when you follow established patterns. Extracting components, using consistent spacing and color scales, leveraging the configuration file for design tokens, and creating custom plugins keep your styles maintainable. Combining Tailwind with CSS custom properties provides flexibility for theming and dynamic styles.",
  },
  {
    url: "/blog/css-grid-layouts",
    title: "Modern CSS Grid Layout Patterns",
    body: "CSS Grid provides a two-dimensional layout system that handles both columns and rows. Common patterns include the holy grail layout, card grids with auto-fill, sidebar layouts, and overlapping content. CSS Grid works best alongside Flexbox, using Grid for page-level layouts and Flexbox for component-level alignment.",
  },
  // Testing cluster
  {
    url: "/blog/vitest-testing-guide",
    title: "Testing with Vitest: A Complete Guide",
    body: "Vitest is a fast unit testing framework powered by Vite. It provides Jest-compatible APIs with native TypeScript support, ESM compatibility, and fast hot module replacement for watch mode. Setting up Vitest for a Next.js project involves configuring the Vite environment and understanding how to mock dependencies effectively.",
  },
  {
    url: "/blog/testing-react-components",
    title: "Testing React Components with Testing Library",
    body: "React Testing Library encourages testing components the way users interact with them. Focus on querying by accessible roles and text rather than implementation details. Test user interactions with fireEvent or userEvent, and verify outcomes through visible changes in the DOM. This approach produces tests that are resilient to refactoring.",
  },
  {
    url: "/blog/integration-testing-strategies",
    title: "Integration Testing Strategies for Web Applications",
    body: "Integration tests verify that multiple parts of your application work together correctly. They fill the gap between fast unit tests and slow end-to-end tests. Effective integration testing strategies include testing API routes with in-memory databases, testing component trees with mocked services, and testing data flows through multiple layers of the application stack.",
  },
];

async function main() {
  console.log("Seeding database...");

  // ── User (upsert for idempotency) ──
  const user = await prisma.user.upsert({
    where: { email: "demo@seo-ilator.dev" },
    update: { name: "Demo User" },
    create: {
      email: "demo@seo-ilator.dev",
      name: "Demo User",
      plan: "pro",
      articleLimit: 500,
      runLimit: 50,
    },
  });
  console.log(`  User: ${user.email} (${user.id})`);

  // ── Project (upsert by looking up existing) ──
  let project = await prisma.project.findFirst({
    where: { userId: user.id, name: "Demo Blog" },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        userId: user.id,
        name: "Demo Blog",
      },
    });
  }
  console.log(`  Project: ${project.name} (${project.id})`);

  // ── Articles ──
  const articles = [];
  for (const tpl of articleTemplates) {
    const article = await prisma.article.upsert({
      where: {
        projectId_url: {
          projectId: project.id,
          url: tpl.url,
        },
      },
      update: {
        title: tpl.title,
        body: tpl.body,
        bodyHash: hash(tpl.body),
        titleHash: hash(tpl.title),
        wordCount: tpl.body.split(/\s+/).length,
      },
      create: {
        projectId: project.id,
        url: tpl.url,
        title: tpl.title,
        body: tpl.body,
        bodyHash: hash(tpl.body),
        titleHash: hash(tpl.title),
        wordCount: tpl.body.split(/\s+/).length,
        sourceType: "seed",
        httpStatus: 200,
      },
    });
    articles.push(article);
  }
  console.log(`  Articles: ${articles.length} created/updated`);

  // ── Analysis Runs ──
  const run1 = await prisma.analysisRun.create({
    data: {
      projectId: project.id,
      status: "completed",
      strategiesUsed: ["crosslink"],
      configuration: {
        matchingApproach: "keyword",
        maxLinksPerPage: 5,
        similarityThreshold: 0.7,
      },
      articleCount: articles.length,
      recommendationCount: 15,
      embeddingsCached: 0,
      embeddingsGenerated: 0,
      startedAt: new Date(Date.now() - 3600_000),
      completedAt: new Date(Date.now() - 3500_000),
    },
  });

  const run2 = await prisma.analysisRun.create({
    data: {
      projectId: project.id,
      status: "completed",
      strategiesUsed: ["crosslink", "meta-tags"],
      configuration: {
        matchingApproach: "semantic",
        maxLinksPerPage: 3,
        similarityThreshold: 0.8,
      },
      articleCount: articles.length,
      recommendationCount: 15,
      embeddingsCached: 10,
      embeddingsGenerated: 5,
      startedAt: new Date(Date.now() - 1800_000),
      completedAt: new Date(Date.now() - 1700_000),
    },
  });
  console.log(`  Analysis runs: 2 created`);

  // ── Recommendations ──
  // 30 total: 10 critical, 10 warning, 10 info; 20 pending, 5 accepted, 5 dismissed
  const severities: Array<"critical" | "warning" | "info"> = [];
  for (let i = 0; i < 10; i++) severities.push("critical");
  for (let i = 0; i < 10; i++) severities.push("warning");
  for (let i = 0; i < 10; i++) severities.push("info");

  const statuses: string[] = [];
  for (let i = 0; i < 20; i++) statuses.push("pending");
  for (let i = 0; i < 5; i++) statuses.push("accepted");
  for (let i = 0; i < 5; i++) statuses.push("dismissed");

  let recCount = 0;
  for (let i = 0; i < 30; i++) {
    const run = i < 15 ? run1 : run2;
    const sourceIdx = i % articles.length;
    let targetIdx = (i + 1 + Math.floor(i / 3)) % articles.length;
    // Avoid source === target
    if (sourceIdx === targetIdx) {
      targetIdx = (targetIdx + 1) % articles.length;
    }

    const source = articles[sourceIdx];
    const target = articles[targetIdx];
    const severity = severities[i];
    const status = statuses[i];

    await prisma.recommendation.create({
      data: {
        projectId: project.id,
        analysisRunId: run.id,
        strategyId: i < 20 ? "crosslink" : "meta-tags",
        sourceArticleId: source.id,
        targetArticleId: target.id,
        type: i < 20 ? "crosslink" : "meta",
        severity,
        title: `Add link from "${source.title}" to "${target.title}"`,
        description: `The article "${source.title}" discusses a topic closely related to "${target.title}". Adding a crosslink would improve navigation and SEO link equity.`,
        anchorText:
          i < 20
            ? target.title.split(":")[0].trim().toLowerCase()
            : undefined,
        confidence: parseFloat((0.6 + Math.random() * 0.35).toFixed(3)),
        matchingApproach: i < 15 ? "keyword" : "semantic",
        status,
        dismissReason:
          status === "dismissed" ? "Not relevant to content" : undefined,
        suggestion:
          i < 20
            ? {
                anchorText: target.title.split(":")[0].trim().toLowerCase(),
                targetUrl: target.url,
              }
            : {
                currentValue: "Missing meta description",
                suggestedValue: `Learn about ${target.title.toLowerCase()} in this comprehensive guide.`,
              },
      },
    });
    recCount++;
  }
  console.log(`  Recommendations: ${recCount} created`);

  // ── Strategy Config ──
  await prisma.strategyConfig.upsert({
    where: {
      projectId_strategyId: {
        projectId: project.id,
        strategyId: "crosslink",
      },
    },
    update: {
      settings: {
        maxLinksPerPage: 5,
        similarityThreshold: 0.7,
        matchingApproach: "keyword",
        ignoreExistingLinks: true,
        minWordCount: 100,
      },
    },
    create: {
      projectId: project.id,
      strategyId: "crosslink",
      settings: {
        maxLinksPerPage: 5,
        similarityThreshold: 0.7,
        matchingApproach: "keyword",
        ignoreExistingLinks: true,
        minWordCount: 100,
      },
    },
  });
  console.log(`  Strategy config: 1 created/updated`);

  // ── Ingestion Job + Tasks ──
  const job = await prisma.ingestionJob.create({
    data: {
      projectId: project.id,
      status: "completed",
      totalUrls: 5,
      completedUrls: 5,
      failedUrls: 0,
      preset: "gentle",
      completedAt: new Date(Date.now() - 7200_000),
    },
  });

  const taskUrls = articleTemplates.slice(0, 5).map((t) => t.url);
  for (const url of taskUrls) {
    await prisma.ingestionTask.create({
      data: {
        jobId: job.id,
        url,
        status: "completed",
        httpStatus: 200,
        responseTimeMs: 150 + Math.floor(Math.random() * 300),
        retryCount: 0,
        startedAt: new Date(Date.now() - 7200_000),
        processedAt: new Date(Date.now() - 7190_000),
      },
    });
  }
  console.log(`  Ingestion job: 1 with 5 tasks created`);

  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
