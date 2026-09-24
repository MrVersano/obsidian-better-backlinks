# Better Backlinks

Better Backlinks adds a **Backlinks** section to the bottom of every note. Each note that links to the current note gets a card, and each card shows the **whole block** around the link as rendered markdown, not a one-line search hit.

- A link in a **heading** shows that heading's whole section.
- A link in a **list item** shows the item and everything nested under it. When the item is nested, its parent items appear above it, dimmed, for context.
- A link in a **paragraph**, **table**, **blockquote** or **callout** shows that block.
- A link in a **property**, such as `related: "[[Project Phoenix]]"`, appears as a row at the top of the card, showing the property's name and all its values.
- If several links fall in the same block, or one block contains another, they appear once, with every link highlighted.

Notes whose **title contains this note's name** also appear, even if they never link to it. For example, `2026-09-24 Meeting with Joe` appears under the daily note `2026-09-24`. These cards show just the title, with the matching part highlighted and "title match" beside it. The name must appear as a whole word in any case, so a note called `Joe` matches `Meeting with Joe` but not `Joel's plan`. Titles identical to the note's name don't count, and neither do one-character names. If a note also links here, it gets a normal card instead.

### Unlinked mentions

Below the backlinks, an **Unlinked mentions** group lists notes that write this note's name as plain text without linking it. For example, "Planning to do x on 2026-09-24 in the evening" appears under the daily note `2026-09-24`. Each card shows the block around the mention, with the text marked by a dashed underline. The cards start collapsed.

- **Link** after a mention turns that text into a link, for example `2026-09-24` becomes `[[2026-09-24]]`. Text cased differently from the note's name keeps its wording as the link's display text, so `project atlas` becomes `[[Project Atlas|project atlas]]`. Links follow your vault's link settings (wikilinks or Markdown links, and the path format).
- **Link all** on a card links every mention in that note.
- **Click the marked text** to jump to it in the source note.

Once a note is linked, its card moves up into the backlinks. Mentions are matched the same way as titles (whole words, any case). Text inside existing links, tags, properties, code, URLs, `%% comments %%` and math is ignored. In a large vault the group fills in over a second or so after the note opens, because every note has to be read; the backlinks above it appear straight away.

The section scrolls with the note in Live Preview, Source mode and Reading view. On a short note it sits at the bottom of the pane like a footer. It takes every colour and font from your theme, and it's hidden when a note has no backlinks.

## Using it

- **Click a card's title** to open that note. Cmd/Ctrl-click opens it in a new tab.
- **Click a highlighted link** to jump to that exact spot in the source note. The link is selected and briefly flashes so you can find it.
- **Click a highlighted property link** to open the source note with that property flashing.
- **Tick a checkbox** in an excerpt to update the task in the source note. This is the only edit an excerpt allows.
- **Click a card's header** to collapse or expand it, or use **Collapse all / Expand all**, which covers the backlink cards. Each card remembers its state for the note you're viewing.
- **Hover a title or link** while holding Cmd/Ctrl to see a Page Preview popover. You can change whether the modifier is needed under Settings → Core plugins → Page preview → Better Backlinks.

### Sorting

Cards are sorted by modified date, newest first, unless you choose otherwise. The sort button in the Backlinks header offers name (A to Z or Z to A), modified date and created date (newest or oldest first). The order applies to the backlinks and the unlinked mentions; blocks inside a card stay in the order they appear in the note.

The order you pick is saved for the note you're viewing. Other notes keep the default, which you can change in the plugin settings. To make a note follow the default again, choose **Use default** in its sort menu. When sorting by created date, cards show when each note was created instead of when it was modified.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Show backlinks section | On | Also available as the **Toggle backlinks section** command. The plugin sets no hotkey; you can assign one yourself. |
| Default sort order | Modified (newest first) | Used by every note that hasn't been given its own order from the sort menu. |
| Expand cards by default up to | 4 backlinks | Notes with more backlinks than this start with their cards collapsed. |
| Mentions shown per card | 3 | Further blocks sit behind "+N more mentions". The property row doesn't count toward this. |
| Highlight matches | On | Highlights links to this note in excerpts and properties, and the matching part of title-match titles. When off, they look like ordinary links and text but still jump to the mention when clicked. |
| Show in Reading view | On | |
| Include links in properties | On | Counts links in a note's properties as backlinks. Turn it off to count links in the note body only. |
| Include title matches | On | Shows notes whose title contains this note's name, even without a link. |
| Show unlinked mentions | On | Lists notes that mention this note's name as plain text, with buttons to link them. |
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
