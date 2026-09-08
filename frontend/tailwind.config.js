/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Sentinel cyberpunk palette (user-specified)
        bone: "#E9E3DF",
        blaze: "#FF7A30",
        steel: "#465C88",
        void: "#000000",
        panel: "#0A0A0B",
        carbon: "#111214",
        // shadcn tokens mapped onto palette
        border: "#2A3040",
        input: "#1A1D24",
        ring: "#FF7A30",
        background: "#000000",
        foreground: "#E9E3DF",
        primary: {
          DEFAULT: "#FF7A30",
          foreground: "#000000",
        },
        secondary: {
          DEFAULT: "#465C88",
          foreground: "#E9E3DF",
        },
        muted: {
          DEFAULT: "#151821",
          foreground: "#8A93A8",
        },
        accent: {
          DEFAULT: "#FF7A30",
          foreground: "#000000",
        },
        card: {
          DEFAULT: "#0A0A0B",
          foreground: "#E9E3DF",
        },
        popover: {
          DEFAULT: "#0A0A0B",
          foreground: "#E9E3DF",
        },
        destructive: {
          DEFAULT: "#ff2d55",
          foreground: "#E9E3DF",
        },
        sentinel: {
          bg: "#000000",
          card: "#0A0A0B",
          border: "#2A3040",
          accent: "#FF7A30",
          steel: "#465C88",
          bone: "#E9E3DF",
          danger: "#ff2d55",
          warning: "#FF7A30",
          success: "#3ddc84",
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', '"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
        sans: ['"Inter"', "sans-serif"],
      },
      boxShadow: {
        "neon-orange":
          "0 0 18px rgba(255,122,48,0.35), 0 0 48px rgba(255,122,48,0.12)",
        "neon-steel": "0 0 18px rgba(70,92,136,0.45)",
        hud: "0 0 0 1px rgba(0,0,0,0.8), 0 0 32px rgba(70,92,136,0.12)",
      },
      keyframes: {
        "scan-drift": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 12px rgba(255,122,48,0.4)" },
          "50%": { boxShadow: "0 0 28px rgba(255,122,48,0.75)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "scan-drift": "scan-drift 9s linear infinite",
        flicker: "flicker 3s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2.2s ease-in-out infinite",
        marquee: "marquee 28s linear infinite",
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  plugins: [require("tailwindcss-animate")],
};
