import { nextui } from "@nextui-org/theme"
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
      }
    },
  },
  safelist: [ ...["green-400", "red-400", "yellow-400"].flatMap(x=>[`bg-${x}`, `text-${x}`, `border-${x}`]) ],
  darkMode: ["class"],
  plugins: [nextui({
    layout: {
      disabledOpacity: "1.0"
    }
  })],
}