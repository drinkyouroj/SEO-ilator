import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Session } from "next-auth";

/**
 * Get the current session. Returns null if unauthenticated.
 * This is the sole entry point for session access in server code.
 * All other server code imports from here.
 */
export async function getSession(): Promise<Session | null> {
  return auth();
}

/**
 * Require authentication. Throws a Response with 401 if unauthenticated.
 * Returns validated userId and projectId for downstream use.
 */
export async function requireAuth(): Promise<{
  userId: string;
  projectId: string;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}> {
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id, name, email, image, projectId } = session.user;

  if (!projectId) {
    throw new Response(
      JSON.stringify({ error: "No project found. Please contact support." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return {
    userId: id,
    projectId,
    user: { id, name, email, image },
  };
}

/**
 * Get the current user with their active project.
 * Throws 401 if unauthenticated.
 */
export async function getCurrentUser() {
  const { userId } = await requireAuth();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      projects: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  const project = user.projects[0];
  if (!project) {
    throw new Response(JSON.stringify({ error: "No project found." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { ...user, project };
}
