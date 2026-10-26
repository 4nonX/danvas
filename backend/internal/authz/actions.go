// Workspace actions, permissions and roles (F42, docs/roadmap/42-roles-and-
// permissions.md). An Action is one thing the server checks (rename a design,
// upload a colour profile, ...). A permission is a named bundle of actions,
// each with a scope; a role is a set of permissions; a member has one role.
// Permissions and roles are data, defined per workspace; this file defines
// the actions (the code is what can enforce them), the bundles and roles every
// workspace starts with, and how a member's effective actions are computed.
// Pure logic: the accounts package loads the data and asks here.
package authz

import "sort"

// Action is a key like "design.rename". Mirrored in @hc/authz (actions.ts);
// the parity test there reads this file.
type Action string

// Scope says where an action applies: on everything, or only on what the
// member created. Unscoped actions are stored with ScopeAll.
type Scope string

const (
	ScopeOwn Scope = "own"
	ScopeAll Scope = "all"
)

const (
	DesignCreate   Action = "design.create"
	DesignRename   Action = "design.rename"
	DesignEdit     Action = "design.edit"
	DesignTrash    Action = "design.trash"
	DesignRestore  Action = "design.restore"
	DesignPurge    Action = "design.purge"
	DesignDownload Action = "design.download"
	// DesignColorList adds the colour list (every colour in every code, the
	// brand's references, the nearest library colours) to a download.
	DesignColorList Action = "design.colorList"
	DesignComment   Action = "design.comment"
	DesignPresent  Action = "design.present"
	// CommentModerate edits and deletes other people's comments.
	CommentModerate Action = "comment.moderate"

	FolderCreate   Action = "folder.create"
	FolderEdit     Action = "folder.edit"
	FolderDelete   Action = "folder.delete"
	FolderDefaults Action = "folder.defaults"

	AssetUpload Action = "asset.upload"
	AssetEdit   Action = "asset.edit"
	AssetDelete Action = "asset.delete"

	ShareTeam     Action = "share.team"
	ShareExternal Action = "share.external"
	ShareRequests Action = "share.requests"

	ApprovalRequest Action = "approval.request"
	ApprovalDecide  Action = "approval.decide"

	TemplatePublish       Action = "template.publish"
	TemplatePublishPublic Action = "template.publishPublic"
	TemplateDelete        Action = "template.delete"
	TemplateCollections   Action = "template.collections"

	BrandKits    Action = "brand.kits"
	BrandDesigns Action = "brand.designs"
	BrandUnlock  Action = "brand.unlock"
	// BrandLibrary maintains a kit's collections (categories of graphics,
	// icons and photos) without the right to change the brand itself (F50).
	BrandLibrary Action = "brand.library"

	PrintColorProfiles  Action = "print.colorProfiles"
	PrintExportProfiles Action = "print.exportProfiles"
	PrintPrintPresets   Action = "print.printPresets"

	FontsManage Action = "fonts.manage"

	AIUse       Action = "ai.use"
	AIConfigure Action = "ai.configure"

	CanvaUse       Action = "canva.use"
	CanvaConfigure Action = "canva.configure"

	APIKeysManage Action = "apiKeys.manage"

	MembersInvite Action = "members.invite"
	MembersAssign Action = "members.assign"
	MembersRemove Action = "members.remove"
	MembersSSO    Action = "members.sso"
	RolesManage   Action = "roles.manage"
	ActivityView  Action = "activity.view"
)

// ActionDef describes one action. LegacyRole is the lowest of the four fixed
// roles that could perform it before F42 ("viewer", "member", "admin"); the
// seeded roles reproduce exactly that, which the tests prove.
type ActionDef struct {
	Key        Action `json:"key"`
	Area       string `json:"area"`
	Scoped     bool   `json:"scoped"`
	LegacyRole string `json:"-"`
}

// Actions is the catalog, in the order the UI lists it.
var Actions = []ActionDef{
	{DesignCreate, "designs", false, "member"},
	{DesignRename, "designs", true, "member"},
	{DesignEdit, "designs", true, "member"},
	{DesignTrash, "designs", true, "member"},
	{DesignRestore, "designs", true, "member"},
	{DesignPurge, "designs", true, "member"},
	{DesignDownload, "designs", false, "viewer"},
	{DesignColorList, "designs", false, "viewer"},
	{DesignComment, "designs", false, "viewer"},
	{DesignPresent, "designs", false, "member"},
	{CommentModerate, "designs", false, "admin"},

	{FolderCreate, "folders", false, "member"},
	{FolderEdit, "folders", true, "member"},
	{FolderDelete, "folders", true, "member"},
	{FolderDefaults, "folders", false, "admin"},

	{AssetUpload, "uploads", false, "member"},
	{AssetEdit, "uploads", true, "member"},
	{AssetDelete, "uploads", true, "member"},

	{ShareTeam, "sharing", false, "member"},
	{ShareExternal, "sharing", false, "member"},
	{ShareRequests, "sharing", false, "member"},

	{ApprovalRequest, "approvals", false, "member"},
	{ApprovalDecide, "approvals", false, "admin"},

	{TemplatePublish, "templates", false, "member"},
	{TemplatePublishPublic, "templates", false, "member"},
	{TemplateDelete, "templates", false, "admin"}, // others' templates; creators always delete their own
	{TemplateCollections, "templates", false, "member"},

	{BrandKits, "brand", false, "admin"},
	{BrandDesigns, "brand", false, "admin"},
	{BrandUnlock, "brand", false, "admin"},
	{BrandLibrary, "brand", false, "admin"},

	{PrintColorProfiles, "print", false, "admin"},
	{PrintExportProfiles, "print", false, "admin"},
	{PrintPrintPresets, "print", false, "admin"},

	{FontsManage, "fonts", false, "admin"},

	{AIUse, "ai", false, "member"},
	{AIConfigure, "ai", false, "admin"},

	{CanvaUse, "integrations", false, "member"},
	{CanvaConfigure, "integrations", false, "admin"},
	{APIKeysManage, "integrations", false, "admin"},

	{MembersInvite, "team", false, "admin"},
	{MembersAssign, "team", false, "admin"},
	{MembersRemove, "team", false, "admin"},
	{MembersSSO, "team", false, "admin"},
	{RolesManage, "team", false, "admin"},
	{ActivityView, "team", false, "admin"},
}

var actionIndex = func() map[Action]ActionDef {
	m := make(map[Action]ActionDef, len(Actions))
	for _, a := range Actions {
		m[a.Key] = a
	}
	return m
}()

// LookupAction reports an action's definition; ok is false for an unknown key.
func LookupAction(a Action) (ActionDef, bool) {
	d, ok := actionIndex[a]
	return d, ok
}

// ActionSet is a permission's or a member's actions with their scope.
type ActionSet map[Action]Scope

// Normalized drops unknown actions and invalid scopes, and stores unscoped
// actions as ScopeAll, so stored data from any release reads safely.
func (s ActionSet) Normalized() ActionSet {
	out := ActionSet{}
	for a, sc := range s {
		def, ok := actionIndex[a]
		if !ok || (sc != ScopeOwn && sc != ScopeAll) {
			continue
		}
		if !def.Scoped {
			sc = ScopeAll
		}
		out[a] = sc
	}
	return out
}

// Union merges sets: an action present in any of them, with the widest scope.
func Union(sets ...ActionSet) ActionSet {
	out := ActionSet{}
	for _, s := range sets {
		for a, sc := range s.Normalized() {
			if cur, ok := out[a]; !ok || (cur == ScopeOwn && sc == ScopeAll) {
				out[a] = sc
			}
		}
	}
	return out
}

// Everything is every action at ScopeAll: what the protected owner role has.
func Everything() ActionSet {
	out := make(ActionSet, len(Actions))
	for _, a := range Actions {
		out[a.Key] = ScopeAll
	}
	return out
}

// Allows reports whether the set permits the action. own says whether the
// target was created by the member (only consulted for scoped actions).
func (s ActionSet) Allows(a Action, own bool) bool {
	sc, ok := s[a]
	if !ok {
		return false
	}
	return sc == ScopeAll || own
}

// Has reports whether the set holds the action at any scope.
func (s ActionSet) Has(a Action) bool {
	_, ok := s[a]
	return ok
}

// Covers reports whether s holds every action of other at least as widely:
// the no-escalation rule (a member can only hand out what they hold).
func (s ActionSet) Covers(other ActionSet) bool {
	for a, sc := range other.Normalized() {
		mine, ok := s[a]
		if !ok || (mine == ScopeOwn && sc == ScopeAll) {
			return false
		}
	}
	return true
}

// Keys lists the set's actions in catalog order (for stable API output).
func (s ActionSet) Keys() []Action {
	out := make([]Action, 0, len(s))
	for _, a := range Actions {
		if _, ok := s[a.Key]; ok {
			out = append(out, a.Key)
		}
	}
	return out
}

// BaseRole is the legacy enum value kept on a membership so a release from
// before F42 still reads a sensible rank: never chosen, always derived.
func BaseRole(protected bool, s ActionSet) string {
	switch {
	case protected:
		return "owner"
	case s.Has(RolesManage):
		return "admin"
	case s.Has(DesignEdit):
		return "member"
	default:
		return "viewer"
	}
}

// MemberAccess is what a member's role contributes to a design's access (the
// input authz.Resolve used to take from the fixed role): the base mode and
// the role's design capabilities.
type MemberAccess struct {
	BaseMode     AccessMode
	Capabilities []Capability
}

// DesignAccessFor derives the design-level contribution of a member's actions.
func DesignAccessFor(s ActionSet) MemberAccess {
	mode := ModeView
	if s.Has(DesignEdit) {
		mode = ModeEdit
	}
	caps := []Capability{CapView}
	if s.Has(DesignComment) || mode == ModeEdit {
		caps = append(caps, CapComment)
	}
	if mode == ModeEdit {
		caps = append(caps, CapEdit)
	}
	add := func(a Action, c Capability) {
		if s.Has(a) {
			caps = append(caps, c)
		}
	}
	add(ShareTeam, CapShare)
	add(ApprovalDecide, CapApprove)
	add(RolesManage, CapManageRoles)
	add(BrandDesigns, CapManageBrand)
	add(BrandUnlock, CapManageLocks)
	// CapDelete only ever gated changing other people's comments.
	add(CommentModerate, CapDelete)
	sort.Slice(caps, func(i, j int) bool { return caps[i] < caps[j] })
	return MemberAccess{BaseMode: mode, Capabilities: caps}
}
