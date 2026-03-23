import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      projectId: string;
    };
  }
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: "database",
    // [AAP-F5] 30-day session duration, refreshed on authenticated activity.
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    updateAge: 24 * 60 * 60, // Refresh session every 24 hours of activity
  },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.EMAIL_FROM ?? "noreply@seo-ilator.com",
    }),
  ],

  pages: {
    signIn: "/auth/sign-in",
    error: "/auth/error",
  },

  callbacks: {
    async signIn({ user }) {
      if (!user.id) return true;

      // Auto-create a default Project on first login
      const existingProject = await prisma.project.findFirst({
        where: { userId: user.id },
      });

      if (!existingProject) {
        await prisma.project.create({
          data: {
            userId: user.id,
            name: "My First Project",
          },
        });
      }

      return true;
    },

    async session({ session, user }) {
      // Attach projectId to session so downstream code can scope queries
      const project = await prisma.project.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });

      session.user.id = user.id;
      session.user.projectId = project?.id ?? "";

      return session;
    },
  },
};
