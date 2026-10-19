# Thread: System Architecture & Design Document

**Version:** 1.1 (Vibecoding Baseline with UI/UX Reference Integration)
**Core Philosophy:** A local-first, Core/Host structured workspace that combines the relational power of Notion, the local resilience of Obsidian, the publishing capabilities of Word, and the project management of Scrivener.

## 1. Core Nomenclature (The Vibe)

To maintain an intuitive but flavorful user experience, Thread maps standard PKM and writing terms to a specific vocabulary. **Use these terms in the UI, but keep the underlying data structures literal.**

* **Thread:** A single note. Technically a local, plain-text `.md` file.
* **Stitch:** A bidirectional link (e.g., `[[Lore_Entry]]`).
* **Deep Stitch:** A bidirectional link tied to a specific coordinate/highlight inside a PDF or ePub (e.g., `[[Research.pdf#page=12&highlight=45]]`).
* **Dye:** A tag or metadata property. Handled via YAML frontmatter but rendered as colored UI badges.
* **Table:** A Notion-style relational database block. Saved as Markdown tables or JSON blocks inside the `.md` file, rendered as an interactive UI.
* **Project:** A folder/workspace. Acts as a nested page (Clicking a Project opens its central dashboard Thread, while housing sub-files locally).
* **Tapestry:** The visual network mind-map of connected Threads (Graph View).
* **The Pinboard:** An infinite 2D canvas for visual worldbuilding, saved as a `.json` block inside a Thread.
* **The Desk:** A split-screen research view (PDF/ePub on the left, active Thread on the right).
* **The Compiler (Manuscript):** The Scrivener-style export engine that binds scattered Threads into formatted PDFs.

## 2. Technical Stack (Foundations for Vibecoding)

* **Framework / Shell:** Tauri (Rust) for desktop/host access with native file system permissions.
* **Frontend UI:** React or Vue.js.
* **Editor Canvas:** TipTap or ProseMirror (Headless WYSIWYG editor). Must render Markdown visually but serialize directly back to standard `.md`.
* **Sync Engine:** Yjs (CRDT) to handle block-level state management and conflict-free syncing across devices.
* **Visual Canvas (Pinboards):** tldraw or Excalidraw libraries.
* **Document Engines:**
  * *Compiler:* Pandoc and/or WordCraft for heavy-duty typesetting and manuscript export.
  * *Research:* PDFCraft, `pdf.js`, or PyMuPDF for native rendering and coordinate-level highlight extraction.

## 3. Data Storage & Sync Architecture

Thread avoids fragile P2P cloud syncing in favor of a **Core/Host Architecture**.

1. **The Host (The Loom):** Runs on a self-hosted Linux machine, Docker container, or local home server. Holds the absolute master directory of all `.md` files, PDFs, and images.
2. **The Satellites:** Desktop apps, iPad, and Mobile apps. They cache text and images locally for completely offline worldbuilding and writing.
3. **The Event Stream:** Satellites log every keystroke or change as an immutable event. Upon internet connection, they stream event logs back to the Host. The Host (using Yjs CRDT logic) merges the events without overwriting data.

## 4. Visual Interface & Design Philosophy

### The Design Ethos
The UI must feel **modular, modern, and punchy**. It relies heavily on distinct cards and blocks rather than flat endless menus. Transitions between states, panels, and views must be buttery smooth. 

**Personalization ("Make your THREAD your own"):** Thread is deeply customizable. The background images, radial blur intensities, fonts, and color palettes can all be swapped out by the user to fit their specific worldbuilding mood or aesthetic preferences.

### Aesthetic Rules & Reference Assets
Use the following provided image files verbatim as aesthetic targets for Vibecoding the frontend components:

* **Logo & Typography Reference:** 
  * See `3be739fe00e0d1e8328d95d95947ac16.jpg` for the core geometric branding, typography weight, and line-based logo design.
* **Modular UI & Punchy Layouts:** 
  * See `fd0c97d777ce80664875afeea972bab8.jpg` for the clean, punchy, high-contrast block card designs.
  * See `9a77f5af79e5648c76cc52daf3fe6304.jpg` to inform the tactical, modular, node-based component feel (useful for frontmatter properties or UI dashboards).
* **Backgrounds & Radial Blurs:** 
  * See `download.jpg` and `36d30084ca6e5eabbef24d927ced3314.jpg` (sidebar navigation) for inspiration on textured, atmospheric backgrounds.
  * See `4290bb884878f8153bdff411bb020073.jpg` (light card) and `006dc3739453a8693100b4c4805c64cb.jpg` (dark card) for the implementation of soft radial blurs behind modular UI elements.
* **Color Palettes:**
  * See `5d6e66cafe28eea224cb9f0776de8d81.jpg` for the baseline muted, earthy accent tones (the "Dyes") mixed with high-contrast UI elements.
* **Tapestry / Network Graph Routing:**
  * See `281a57c4145c7ed77a03ea6eae05bf04.jpg` for clean, colorful line-routing concepts to be used in the Tapestry's node graph view or file history versioning.

### The Three-Pane Layout

1. **The Spool (Left Sidebar):**
   * Floating, modular sidebar (reference: `36d30084ca6e5eabbef24d927ced3314.jpg`).
   * Nested Project tree with punchy hover states.
   * List of Dyes (Tags) for quick filtering.
2. **The Canvas (Center):**
   * Distraction-free TipTap editor sitting on top of a highly customizable background with soft radial blurs.
   * Typing `/` opens the modular block-menu.
3. **The Stitching (Right Sidebar):**
   * Backlinks (Stitched From...).
   * Frontmatter UI (Add properties using blocky, tactile UI components).

## 5. Core Feature Specifications

### A. Notion-Style Tables (Relational Blocks)
* **UX:** Appears as a rich spreadsheet inside the Canvas. Columns have data types (Number, Text, Link). Uses the punchy design language of the reference cards.
* **Under the hood:** The frontend uses React to render the table. It serializes into the `.md` file as a standardized Markdown table (for portability) or a hidden JSON block (if advanced formulas are used).

### B. "The Desk" & Deep Stitching (Research Engine)
* **UX:** Modular split screen. PDFCraft reader on the left, active Thread on the right. Smooth transitions when collapsing or expanding panes.
* **Action:** User highlights text in the PDF and applies a Dye.
* **Automation:** The app generates a unique ID for that highlight, pulls the text into the active Thread as a blockquote, and appends a `[[Deep Stitch]]`. Clicking the stitch later opens the PDF exactly to that coordinate.

### C. The Tapestry Compiler (Export Engine)
* **UX:** A visual corkboard or vertical drag-and-drop list utilizing soft shadow and radial blur card components.
* **Action:** User arranges Title Page Thread, Chapter Threads, and Appendix Threads.
* **Automation:** The Compiler strips out UI code (hidden Dyes, bracket syntax), parses the Markdown via Pandoc/WordCraft, applies standard pagination/headers, and generates a print-ready PDF or Word document.