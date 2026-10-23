# Brand kit files

A brand kit can be saved as one file and loaded into another workspace or another danvas instance. Use it to move a kit, keep a backup outside the instance, hand a kit to someone else, or write a kit by hand or with a script.

## Export and import

Both are on the dashboard's **Brand** page: export and import under **Settings**, **Kit file**, and import also under **New brand**. They need the right **Define the brand** (workspace owners and admins).

- **Export** saves the brand shown on the page, at its latest version, as `<name>.brandkit.zip`. The file holds the colors, fonts, logos with their dark and light versions, the icon, photo and graphics collections, the voice and the controls. It also holds the font files of every workspace font the kit names. If a file the kit refers to can no longer be read, the export leaves it out and says how many are missing.
- **Import** reads a `.brandkit.zip`, or a bare `brandkit.json` for a kit without files. It uploads the logos and images into the workspace's uploads and the font files into the workspace fonts, then creates the kit.
- **The same name already exists**: the import shows both kits side by side (version, last change, number of colors, fonts, logos and images) and asks:
  - **Replace the existing kit**: the kit takes the file's content. Its earlier state stays in the version history and can be restored from there. Designs that use the kit keep using it. Logos and images whose bytes are already in that kit are reused, not uploaded again.
  - **Keep both and import under another name**: a free name is suggested and can be changed.
- **Font files already in the workspace** (the same file, even under another name) are not uploaded again. If such a file is there under a different family name, the import says which families the kit names but the workspace does not have under that name.
- **The voice's AI model profile** is not exported, because it exists only in the source workspace.

## The archive

A standard ZIP archive. Entries may be stored or deflated; encrypted archives and ZIP64 are not read. The manifest `brandkit.json` sits at the root of the archive, or inside a single top folder (as when a folder is packed with a zip tool). All other paths in the manifest are relative to the manifest's folder and use forward slashes.

```
acme.brandkit.zip
├── brandkit.json
├── logos/
│   ├── wordmark.svg
│   └── wordmark-dark.svg
├── icons/
│   └── arrow.svg
├── photos/
│   └── team.jpg
└── fonts/
    ├── brand-sans-400.woff2
    └── brand-sans-700.woff2
```

Exports use these folders and lowercase file names; an import accepts any paths the manifest names. Every file the manifest names must be in the archive, or the import stops and names the first one missing. Files the manifest does not name are ignored.

## brandkit.json

```json
{
  "format": "danvas.brandkit",
  "formatVersion": 1,
  "name": "Acme",
  "exportedAt": "2026-10-16T12:00:00.000Z",
  "palettes": [
    {
      "id": "p-main",
      "name": "Main",
      "colors": [
        { "id": "s-red", "role": "primary", "name": "Acme Red", "hex": "#d0021b",
          "cmyk": { "c": 0, "m": 1, "y": 0.87, "k": 0.18 } },
        { "role": "accent", "hex": "#0080ff80" },
        { "role": "spot", "hex": "#00a3e0",
          "spot": { "name": "PANTONE 299 C", "book": "PANTONE+ Solid Coated", "fallback": { "c": 0.86, "m": 0.08, "y": 0, "k": 0 } } }
      ]
    }
  ],
  "fonts": [
    { "role": "heading", "family": "Brand Sans", "defaultStyle": { "weight": 700 } },
    { "role": "body", "family": "Inter" }
  ],
  "fontFiles": [
    { "family": "Brand Sans", "weight": 400, "style": "normal", "file": "fonts/brand-sans-400.woff2" },
    { "family": "Brand Sans", "weight": 700, "style": "normal", "file": "fonts/brand-sans-700.woff2" }
  ],
  "logos": [
    { "label": "Wordmark", "file": "logos/wordmark.svg", "darkFile": "logos/wordmark-dark.svg",
      "clearSpaceRatio": 0.25, "minSizePx": 24 }
  ],
  "collections": [
    { "kind": "icons", "files": ["icons/arrow.svg"] },
    { "kind": "photos", "files": ["photos/team.jpg"] }
  ],
  "voice": {
    "tone": ["warm", "precise"],
    "doSay": ["we"],
    "dontSay": ["cheap"],
    "sampleCopy": "Made with care."
  },
  "controls": { "lockColors": true, "lockFonts": false, "restrictTemplates": false, "lintPolicy": "warn" }
}
```

### Fields

Only `format`, `formatVersion` and `name` are required. Every list may be left out (it counts as empty). Every `id` is optional: an import keeps the ids it finds, so a kit that goes out and comes back keeps its palette, color, font and logo ids, and makes new ones where there are none.

| Field | Type | Meaning |
|---|---|---|
| `format` | `"danvas.brandkit"` | Marks the file as a brand kit. |
| `formatVersion` | whole number | `1`. A file with a higher number than the instance knows is refused with a request to update. |
| `name` | text | The kit's name. Not empty. |
| `exportedAt` | ISO 8601 date | When the file was made. Shown in the import dialog; optional. |
| `palettes[]` | | Named groups of colors. |
| `palettes[].name` | text | The palette's name. |
| `palettes[].colors[].role` | text | What the color is for, such as `primary`, `secondary`, `accent`, `text`, `background`. Default `accent`. |
| `palettes[].colors[].name` | text | Optional name of the color. |
| `palettes[].colors[].hex` | text | The screen color: `#rgb`, `#rrggbb`, or `#rrggbbaa` with transparency. |
| `palettes[].colors[].cmyk` | `{c, m, y, k}` | Optional print value, each channel from 0 to 1. |
| `palettes[].colors[].spot` | `{name, book?, fallback}` | Optional spot color: its name, the color book, and a CMYK fallback (channels 0 to 1). |
| `fonts[].role` | text | What the font is for, such as `heading` or `body`. Default `body`. |
| `fonts[].family` | text | The font family name as it appears in the font pickers. |
| `fonts[].defaultStyle` | `{weight?, size?, tracking?}` | Optional numbers. |
| `fontFiles[]` | | Font files to add to the workspace fonts, one face each. Families not listed here are expected to be built-in or library fonts. |
| `fontFiles[].family` | text | The family the face belongs to. Use the same name as in `fonts[].family`. |
| `fontFiles[].weight` | number | 100 to 900. Default 400. |
| `fontFiles[].style` | `"normal"` or `"italic"` | Default `"normal"`. |
| `fontFiles[].file` | path | A WOFF2, WOFF, TrueType or OpenType file, at most 32 MB. |
| `logos[].label` | text | The logo's name. |
| `logos[].file` | path | The logo for light backgrounds: SVG, PNG, JPEG, WebP, GIF or AVIF. SVG logos are placed as editable shapes. |
| `logos[].darkFile` | path | Optional version for dark backgrounds. |
| `logos[].lightFile` | path | Optional version for light backgrounds, where it differs from `file`. |
| `logos[].clearSpaceRatio` | number | Optional free space around the logo, as a share of its size. |
| `logos[].minSizePx` | number | Optional smallest size in pixels. |
| `collections[].kind` | `"icons"`, `"photos"` or `"graphics"` | The collection. |
| `collections[].name` | text | Optional name of the category (for example `Silhouettes`). A collection without one shows under its kind's name. |
| `collections[].files` | list of paths | Its files. The same file may appear in several places; it is uploaded once. |
| `voice` | object or `null` | `tone`, `doSay` and `dontSay` are lists of text; `sampleCopy` is optional text. |
| `controls.lockColors` | true or false | Members may use only the kit's colors. |
| `controls.lockFonts` | true or false | Members may use only the kit's fonts. |
| `controls.restrictTemplates` | true or false | Members start from brand templates only. |
| `controls.lintPolicy` | `"off"`, `"warn"` or `"block"` | How the brand check treats exports. |
| `fileNames` | object | Optional: a file's original name by its path, for example `{"graphics/klee.svg": "Klee - Silhouette.svg"}`. Imported files get this name; files not listed are named after their path. |

Controls left out keep their current value on a replace and their default on a new kit.

## Writing a kit by hand

1. Make a folder with `brandkit.json` and the logo, image and font files.
2. Fill in the manifest as above; colors only need a `role` and a `hex`.
3. Pack the folder as a ZIP (any tool) and import it. A kit with colors, font names and voice but no files can also be imported as the bare `brandkit.json`.

The import checks the manifest before it uploads anything and names the first problem it finds, such as a color that is not a hex value or a missing file.
