/** Where THREAD's static files live (icons, pdf.js data, Excalidraw fonts).
 *  Resolved from this module's own URL, so it is right at a site root, under
 *  /THREAD/ on GitHub Pages, inside the apps, and when an app runs the live
 *  build from GitHub Pages. Built chunks sit in assets/, one level down. */
export const BASE: string = import.meta.env.DEV ? import.meta.env.BASE_URL : new URL('../', import.meta.url).href
