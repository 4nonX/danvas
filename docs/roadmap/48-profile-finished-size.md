# F48 Finished size in the export profile

A label profile is made for one size (the print shop's 50 x 100 mm), but until now it did not know that: a 90 x 40 mm design exported with it gave a wrong file without a word. The profile now names its finished size, and the download menu says which designs are not in it.

## Requirements

- **FR-1 Setting.** An export profile has an optional **Finished size** (width x height in mm), set in the download menu with the other prepress options and in the profile's **Edit** dialog. Empty means any size. Stored in the profile's settings; no database change, and older versions ignore the field.
- **FR-2 Check.** With a finished size, the download menu checks every exported page of every design. A design is off when a page differs by more than 0.5 mm in width or height (a design drawn at 96 dpi is 89.96 mm for 90 mm). With **Round to whole millimetres** on, the whole-mm size the export makes is compared.
- **FR-3 Turned.** A design that has the size but lies the other way (100 x 50 for 50 x 100) is named as such: "landscape instead of portrait".
- **FR-4 Warning only.** The menu names the designs that are off and their size; the download stays possible, like the other export checks.
- **FR-5 Fix in place.** From the dashboard, **Change format…** opens the format dialog for exactly those designs, set to the finished size; once they are changed, the download menu opens again for the whole selection. In the editor the warning says where the size is changed.
- **FR-6 Description.** The profile's one-line description names the finished size.

## Acceptance

- **AC-1** A profile with 50 x 100 mm and three designs of 50 x 100, 90 x 40 and 100 x 50 mm: the menu names two, the second as "90 × 40 mm", the third as "100 × 50 mm, landscape instead of portrait".
- **AC-2** **Change format…** opens with 50 x 100 mm and those two designs; after saving, the download menu shows no warning.
- **AC-3** A profile without a finished size behaves as before; an older client opening the profile keeps working.
