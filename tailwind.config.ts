import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2563eb",
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        destructive: "#dc2626",
        warning: "#f59e0b",
        success: "#16a34a",
        muted: "#9ca3af",
      },
    },
  },
  plugins: [],
};
export default config;
