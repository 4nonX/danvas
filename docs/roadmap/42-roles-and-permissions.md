# F42 Roles and permissions

Each workspace defines who may do what, in three layers:

1. **Actions**: the things danvas can check, one per guarded operation (rename a design, delete it for good, create a share link, upload a colour profile, configure the AI provider, ...). The code defines them; a new feature brings its actions with it.
2. **Permissions**: named bundles of actions, each with a scope where it applies (`own`: only what the member created, `all`). Admins create, edit, duplicate and delete them ("Manage print data" = colour profiles, export profiles, print presets, folder print defaults).
3. **Roles**: named selections of permissions. Admins create, edit, duplicate and delete them, and assign one role to each member, invitation and the SSO auto-join.

This replaces the fixed role ladder (viewer < member < admin < owner) that every check compares against today, and the per-feature switches around it (export profiles and print presets "managed by", fixed owner/admin rules for fonts, colour profiles, AI, Canva, API keys). It implements FR-15 of [38](38-accessibility-i18n-security-compliance-selfhost-nfr.md) at workspace scope. Roles, permissions and the page to manage them ship together in one release.

## Where it stands today

- Four fixed roles (`Role` enum `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` on `workspace_members.role`), compared by rank in `accounts.AssertMember(minRole)` and its wrappers: roughly 120 checks, each with its minimum role written into the handler.
- A capability layer (`authz.Resolve`, nine design capabilities) used for per-design features only: sharing, comments, approvals, whiteboard, brand, template locks, realtime. Its built-in sets derive from the four roles.
- Custom roles (`custom_roles`: name and capabilities) exist, but only attach to a design grant.
- Two "managed by" switches (`workspace_export_settings`), fixed owner/admin rules elsewhere. No permissions per folder, no instance-level administrator.

## Actions

Every guarded route maps to exactly one action. Membership alone still allows reading the workspace (designs, folders, uploads, members, libraries) and personal things (favourites, own notifications), as today. "Scoped" actions take `own` or `all`. "Today" is the minimum role that performs the action before F42; it drives the seeded permissions and roles.

| Area | Action | Scoped | Today |
|---|---|---|---|
| Designs | `design.create` (new, duplicate, bulk create, apply template, copy in) | | member |
| | `design.rename` | yes | member |
| | `design.edit` (save, realtime, restore a version, branch, autofill, convert) | yes | member |
| | `design.trash` (move to trash, move to another workspace) | yes | member |
| | `design.restore` (from trash) | yes | member |
| | `design.purge` (delete for good) | yes | member |
| | `design.download` (render, export) | | viewer |
| | `design.comment` (comment, reply, resolve, react, vote) | | viewer |
| | `design.present` (live presentation controls) | | member |
| Folders | `folder.create` | | member |
| | `folder.edit` (rename, move) | yes | member |
| | `folder.delete` | yes | member |
| | `folder.defaults` (print and export defaults of a folder) | | admin |
| Uploads | `asset.upload` (files, from URL, asset folders) | | member |
| | `asset.edit` (rename, move) | yes | member |
| | `asset.delete` | yes | member |
| Sharing | `share.team` (grant access to people in the workspace) | | member |
| | `share.external` (links, inviting people outside the workspace) | | member |
| | `share.requests` (answer access requests) | | member |
| Approvals | `approval.request` | | member |
| | `approval.decide` (approve, reject, reopen) | | admin |
| Templates | `template.publish` (in the workspace) | | member |
| | `template.publishPublic` (for every user of the instance) | | member |
| | `template.delete` (other people's templates; whoever created a template can always delete it) | | admin |
| | `template.collections` | | member |
| Brand | `brand.kits` (create, edit, delete, restore, default kit) | | admin |
| | `brand.designs` (apply a kit to a design, brand-locked regions, review) | | admin |
| | `brand.unlock` (lift template locks) | | admin |
| Print | `print.colorProfiles` | | admin |
| | `print.exportProfiles` | | admin (member when switched) |
| | `print.printPresets` | | admin (member when switched) |
| Fonts | `fonts.manage` | | admin |
| AI | `ai.use` | | member |
| | `ai.configure` (providers, image provider, policy, search) | | admin |
| Canva | `canva.use` (connect own account, import) | | member |
| | `canva.configure` (the workspace integration) | | admin |
| API | `apiKeys.manage` (keys and their audit) | | admin |
| Team | `members.invite` (invite, revoke invitations) | | admin |
| | `members.assign` (change a member's role) | | admin |
| | `members.remove` | | admin |
| | `members.sso` (SSO auto-join) | | admin |
| | `roles.manage` (permissions and roles: create, edit, delete) | | admin |
| | `activity.view` (the workspace change log) | | admin |

Deleting the workspace is not an action anyone can be given: it stays with the owner role.

The design capabilities of `authz.Resolve` derive from the member's actions instead of the old rank: base mode `edit` when the member has `design.edit` (else `view`); `share` from `share.team`; `approve` from `approval.decide`; `manage-roles` from `roles.manage`; `manage-brand` from `brand.designs`; `manage-locks` from `brand.unlock`; `delete` from `design.trash` with scope `all`. Grants, links and the approval lock combine with it as today.

## Seeded permissions and roles

Every workspace starts with these, so a new workspace works without setup and the migration changes nothing. All of them except the owner role can be edited and deleted like any other.

| Permission | Actions |
|---|---|
| Edit designs | `design.create`, `design.rename` all, `design.edit` all, `design.present` |
| Delete designs | `design.trash` all, `design.restore` all, `design.purge` all |
| Download and comment | `design.download`, `design.comment` |
| Organize folders | `folder.create`, `folder.edit` all, `folder.delete` all |
| Folder print defaults | `folder.defaults` |
| Upload files | `asset.upload`, `asset.edit` all, `asset.delete` all |
| Share | `share.team`, `share.external`, `share.requests`, `approval.request` |
| Approve | `approval.decide` |
| Templates | `template.publish`, `template.publishPublic`, `template.collections` |
| Manage templates | `template.delete` all |
| Brand | `brand.kits`, `brand.designs`, `brand.unlock` |
| Print data | `print.colorProfiles`, `print.exportProfiles`, `print.printPresets` |
| Fonts | `fonts.manage` |
| Use AI and Canva | `ai.use`, `canva.use` |
| Configure integrations | `ai.configure`, `canva.configure`, `apiKeys.manage` |
| Manage team | `members.invite`, `members.assign`, `members.remove`, `members.sso`, `roles.manage`, `activity.view` |

| Role | Permissions |
|---|---|
| Owner (protected) | every action, always |
| Admin | all permissions above |
| Member | Edit designs, Delete designs, Download and comment, Organize folders, Upload files, Share, Templates, Use AI and Canva (plus Print data when export profiles or print presets were "managed by members") |
| Viewer | Download and comment |

## Requirements

- **FR-1 Actions** are defined once in Go (`internal/authz/actions.go`: key, area, scoped) and mirrored in `@hc/authz` with a parity test. A table maps every guarded route to its action; a test fails when a route has none. The UI lists them with a name and a sentence each (catalog strings in every language).
- **FR-2 Permissions** live per workspace in `workspace_permissions` (id, workspace, name, description, actions as a JSON object of action key to scope, created and updated by and at). Names are unique per workspace, ignoring case. An unknown action key in stored data is kept and ignored; an action a newer release adds is in no permission until someone adds it (the owner role has it anyway), so an update never widens anyone's rights by itself.
- **FR-3 Roles** live in `workspace_roles` (id, workspace, name, description, protected flag, created and updated by and at) with `workspace_role_permissions` (role, permission). A member's effective actions are the union of the role's permissions' actions, `all` beating `own`; the protected role has every action at `all`.
- **FR-4 Assignment**: `workspace_members.role_id`, `invitations.role_id` and the SSO auto-join setting's role id. The legacy `role` enum column stays and is kept equal to the role's derived base role (`OWNER` for the protected role, `ADMIN` when the role holds `roles.manage`, `MEMBER` when it holds `design.edit`, else `VIEWER`), so a release from before F42 still reads a sensible rank.
- **FR-5 Seeding**: creating a workspace creates the seeded permissions and roles (one function, used everywhere) and gives its creator the owner role. That covers every new team workspace and the personal workspace each user gets at sign-up, the first one on a fresh instance too. A migration seeds every existing workspace and maps every member, invitation and SSO setting by its current enum value, the two "managed by" switches included.
- **FR-6 Checks**: every handler checks its action through one helper (`accounts.Require(ctx, user, workspace, action, creatorID)`), answering 403 with a problem code naming the action. The frontend gets the caller's effective actions per workspace (`GET /workspaces/{id}/me/actions`) and shows controls by action instead of comparing roles.
- **FR-7 The page "Roles and permissions"** (dashboard, for `roles.manage`; read-only for everyone else): actions (a reference: name, sentence, area, which permissions contain each), permissions (create, edit: name, description, a pick list of actions grouped by area with the scope where scoped; duplicate, delete), roles (create, edit: name, description, a pick list of permissions; duplicate, delete), effective actions per member and per role, and the change log. Deleting a role in use asks which role its members get instead, in the same step; deleting a permission shows which roles lose it.
- **FR-8 Guard rails**, enforced on the server:
  - **No escalation.** A member can only hand out what they hold: a permission they create or edit can only contain actions they have at that scope, they can only add a permission to a role when they hold all its actions, and they can only assign, invite or set for SSO a role whose effective actions they hold. Nobody edits their own role.
  - **Protected owner role.** It always has every action; it can be renamed but not edited or deleted, and only owners assign or remove it.
  - **Never unmanaged.** A workspace always has at least one active owner: the last owner cannot be removed, demoted or have the role deleted.
- **FR-9 Recovery** for self-hosters: `hycanvas workspace grant-owner <workspace> <email>` on the server gives an existing user the owner role (adding the membership if needed). CLI only, never an API.
- **FR-10 Change log**: creating, editing and deleting permissions and roles, and every assignment, are recorded with actor, target, before and after, readable with `activity.view`.
- **FR-11** The two "managed by" switches are retired: their API keeps answering older clients, computed from the roles. Design-scoped custom roles (`custom_roles` on grants) keep working and are folded into workspace roles in a later release.
- **FR-12 Rollback**: only tables and nullable columns are added. A release from before F42 ignores them and reads the legacy enum (FR-4).

## Stages

1. **Roles and permissions** (one release): actions, permissions, roles, seeding and migration, every check moved to actions, the page with full CRUD, effective actions, guard rails, change log, recovery command. A golden test runs every guarded route for the four seeded roles and proves each decision equals the pre-F42 one.
2. **Fold-ins and corrections**: folder print and export defaults (`folder.defaults`), design custom roles folded in. Corrections, each in the changelog: deleting checks `design.trash`, saving honours the approval lock, the seeded Member role loses `template.publishPublic`.
3. **Later**: folders restricted to roles; who may create workspaces on an instance.

## Acceptance

- **AC-1** With the seeded roles, every guarded route decides as before (golden test over all routes and the four roles).
- **AC-2** A role without an action is refused it at the API (403 naming the action) and does not see the control; `own` lets a member act only on what they created.
- **AC-3** An admin creates a permission from any actions they hold, a role from any permissions they hold, assigns it, and the member's effective actions are exactly the union; editing either takes effect on the next request.
- **AC-4** No member can obtain or hand out an action they do not hold; nobody edits their own role; the last owner cannot be removed, demoted or lose the role; the owner role cannot be edited or deleted.
- **AC-5** A new workspace, including the first on a fresh instance, has the seeded permissions and roles and its creator as owner.
- **AC-6** A rollback to the previous release opens every workspace with each member at their role's base rank.
