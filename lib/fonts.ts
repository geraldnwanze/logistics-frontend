import { Inter, Merriweather, Source_Sans_3, Work_Sans } from "next/font/google";

// Only Inter (the default) is preloaded; the others are fetched when the CMS selects them.
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans", display: "swap", preload: false });
export const merriweather = Merriweather({ subsets: ["latin"], variable: "--font-merriweather", display: "swap", preload: false });
export const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-work-sans", display: "swap", preload: false });

export const fontClassNames = [inter, sourceSans, merriweather, workSans].map((f) => f.variable).join(" ");
