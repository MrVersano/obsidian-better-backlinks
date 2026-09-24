# Better Backlinks

Better Backlinks adds a **Backlinks** section to the bottom of every note. Each note that links to the current note gets a card, and each card shows the **whole block** around the link as rendered markdown, not a one-line search hit.

- A link in a **heading** shows that heading's whole section.
- A link in a **list item** shows the item and everything nested under it. When the item is nested, its parent items appear above it, dimmed, for context.
- A link in a **paragraph**, **table**, **blockquote** or **callout** shows that block.
- A link in a **property**, such as `related: "[[Project Phoenix]]"`, appears as a row at the top of the card, showing the property's name and all its values.
- If several links fall in the same block, or one block contains another, they appear once, with every link highlighted.

Notes whose **title contains this note's name** also appear, even if they never link to it. For example, `2026-09-24 Meeting with Joe` appears under the daily note `2026-09-24`. These cards show just the title, with the matching part highlighted and "title match" beside it. The name must appear as a whole word in any case, so a note called `Joe` matches `Meeting with Joe` but not `Joel's plan`. Titles identical to the note's name don't count, and neither do one-character names. If a note also links here, it gets a normal card instead.

The section scrolls with the note in Live Preview, Source mode and Reading view. On a short note it sits at the bottom of the pane like a footer. It takes every colour and font from your theme, and it's hidden when a note has no backlinks.

## Using it

- **Click a card's title** to open that note. Cmd/Ctrl-click opens it in a new tab.
- **Click a highlighted link** to jump to that exact spot in the source note. The link is selected and briefly flashes so you can find it.
- **Click a highlighted property link** to open the source note with that property flashing.
- **Tick a checkbox** in an excerpt to update the task in the source note. This is the only edit an excerpt allows.
- **Click a card's header** to collapse or expand it, or use **Collapse all / Expand all**. Each card remembers its state for the note you're viewing.
- **Hover a title or link** while holding Cmd/Ctrl to see a Page Preview popover. You can change whether the modifier is needed under Settings → Core plugins → Page preview → Better Backlinks.

Cards are sorted with the most recently modified note first.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Show backlinks section | On | Also available as the **Toggle backlinks section** command. The plugin sets no hotkey; you can assign one yourself. |
| Expand cards by default up to | 4 backlinks | Notes with more backlinks than this start with their cards collapsed. |
| Mentions shown per card | 3 | Further blocks sit behind "+N more mentions". The property row doesn't count toward this. |
| Show in Reading view | On | |
| Include links in properties | On | Counts links in a note's properties as backlinks. Turn it off to count links in the note body only. |
| Include title matches | On | Shows notes whose title contains this note's name, even without a link. |
| Excluded folders | None | Notes in these folders never appear as backlinks, for example `Templates`. One folder per line. |

## Turn off Obsidian's own backlinks footer

Obsidian's core Backlinks plugin can also list backlinks at the bottom of notes, which gives you two lists. To turn it off, go to **Settings → Core plugins → Backlinks** and switch off **Show backlinks at the bottom of notes**. The Backlinks pane in the sidebar is separate and not affected.

## Development

```sh
npm install
npm run dev     # rebuild on change
npm run build   # type-check and production build
npm test        # unit tests for block extraction and formatting
```

Each build copies `main.js`, `manifest.json` and `styles.css` into `test-vault/.obsidian/plugins/better-backlinks/`. Open `test-vault` in Obsidian to try the plugin. It contains a note for each kind of link above; `Project Atlas` is the note they link to.

- [src/excerpt.ts](src/excerpt.ts) decides which block to show for each link. It uses no DOM, so it can be unit-tested.
- [src/backlink-index.ts](src/backlink-index.ts) finds the linking notes using Obsidian's metadata cache.
- [src/view.ts](src/view.ts) builds the section, mounts it and keeps it up to date.
- [src/main.ts](src/main.ts) is the plugin entry: events, settings, the command and saved state.
