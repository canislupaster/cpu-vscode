import { nextui } from "@nextui-org/theme"
// eslint-disable-next-line no-unused-vars
import {Config} from "tailwindcss"

/** @type {Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@nextui-org/theme/dist/components/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        "display": "Chivo, sans",
        "body": "Inter, sans"
      },
      screens: {
        "xs": "350px"
      },
      colors: {
        zinc: { "150": "#f0f0f2", "850": "#1e1e21" }
      }
    },
  },
  darkMode: ["class"],
  plugins: [nextui({
    layout: {
      disabledOpacity: "1.0"
    }
  })],
}