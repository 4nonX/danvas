# F47 Print files only after approval

A workspace that prints for others (labels, packaging, signage) wants nothing to reach the press that was not signed off. Approvals (any/all approvers, a server-enforced lock while approved) already exist; this ties print files to them: a member asks for approval, the approver checks the design as it would print and approves it, and only then can print files be made.

## Requirements

- **FR-1 Workspace rule.** A workspace setting **Print files only after approval**, off by default, on the workspace's page under **Print and export**. Every member sees whether it is on; roles with `roles.manage` switch it (`GET`/`PUT /workspaces/{id}/print-policy`).
- **FR-2 What it holds back.** Print files: the print PDF (not the tagged accessible PDF), TIFF and EPS in the download menu, printing, and the server's `render.pdf`. Screen formats (PNG, JPG, SVG, the tagged PDF) stay free, so a draft can still be shared for review.
- **FR-3 Approved means the active approval is granted.** A pending, rejected or reopened approval does not count. An approved design is locked against edits (the existing lock), so what was approved is what prints.
- **FR-4 Approvers are not held up.** Roles with `approval.decide` make print files at any time: they would approve anyway.
- **FR-5 Where the rule shows.** The download menu and the print dialog say why the print buttons are off, how many designs of a selection still wait, and offer **Request approval** to those who may ask for it. The server answers a held-back `render.pdf` with 403 `print_approval_required`.
- **FR-6 Check before approving.** The approval banner has **Print proof**: the soft proof through the design's colour profile (else the default one), single plates and ink coverage against the profile's TAC limit, with bleed, for every page. The approver approves, or rejects with a note, from the same banner.
- **FR-7 Serial print and bulk.** The rule applies to the design a serial print is made from and to every design of a dashboard selection.

## Acceptance

- **AC-1** With the rule on, a member's print PDF, TIFF, EPS and printing are off until the design is approved; a PNG is not.
- **AC-2** After approval the member prints; after **Reopen** the buttons are off again.
- **AC-3** An owner or admin (who decide approvals) prints without approval.
- **AC-4** A member's `GET /designs/{id}/render.pdf` of an unapproved design is 403 `print_approval_required`.
- **AC-5** A member cannot switch the rule; a non-member cannot read it.

## Not in this spec

- Approval stages per role (designer, then customer) and approvals by people outside the workspace (a customer link): later, on top of the share links.
- A record of which version was printed: the lock makes the approved version the printed one; a print log is separate work.
