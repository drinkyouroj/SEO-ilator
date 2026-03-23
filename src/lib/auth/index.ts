import NextAuth from "next-auth";
import { authConfig } from "./config";

/**
 * Central NextAuth.js v5 instance.
 * All server-side auth access should go through these exports.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
