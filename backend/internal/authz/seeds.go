package authz

// The permissions and roles every workspace starts with (F42 FR-5). They
// reproduce the four fixed roles exactly, so creating a workspace or
// migrating one changes nobody's rights; afterwards they are ordinary data
// (all but the owner role can be edited and deleted). Seeded rows keep their
// key, so the UI shows their name in the reader's language until someone
// renames them.

// SeedPermission is a permission bundle every workspace starts with.
type SeedPermission struct {
	Key     string
	Actions ActionSet
}

// SeedRole is a role every workspace starts with.
type SeedRole struct {
	Key         string
	Protected   bool
	Permissions []string // SeedPermission keys
	// LegacyRole is the fixed role it replaces: members, invitations and the
	// SSO setting holding that enum value are mapped to it.
	LegacyRole string
}

func set(pairs ...any) ActionSet {
	out := ActionSet{}
	for i := 0; i < len(pairs); i += 2 {
		out[pairs[i].(Action)] = pairs[i+1].(Scope)
	}
	return out
}

// SeedPermissions are created in every workspace, in this order.
var SeedPermissions = []SeedPermission{
	{"edit-designs", set(DesignCreate, ScopeAll, DesignRename, ScopeAll, DesignEdit, ScopeAll, DesignPresent, ScopeAll)},
	{"delete-designs", set(DesignTrash, ScopeAll, DesignRestore, ScopeAll, DesignPurge, ScopeAll)},
	{"download-comment", set(DesignDownload, ScopeAll, DesignComment, ScopeAll)},
	{"moderate-comments", set(CommentModerate, ScopeAll)},
	{"organize-folders", set(FolderCreate, ScopeAll, FolderEdit, ScopeAll, FolderDelete, ScopeAll)},
	{"folder-defaults", set(FolderDefaults, ScopeAll)},
	{"upload-files", set(AssetUpload, ScopeAll, AssetEdit, ScopeAll, AssetDelete, ScopeAll)},
	{"share", set(ShareTeam, ScopeAll, ShareExternal, ScopeAll, ShareRequests, ScopeAll, ApprovalRequest, ScopeAll)},
	{"approve", set(ApprovalDecide, ScopeAll)},
	{"templates", set(TemplatePublish, ScopeAll, TemplatePublishPublic, ScopeAll, TemplateCollections, ScopeAll)},
	{"manage-templates", set(TemplateDelete, ScopeAll)},
	{"brand", set(BrandKits, ScopeAll, BrandDesigns, ScopeAll, BrandUnlock, ScopeAll)},
	{"print-data", set(PrintColorProfiles, ScopeAll, PrintExportProfiles, ScopeAll, PrintPrintPresets, ScopeAll)},
	{"fonts", set(FontsManage, ScopeAll)},
	{"use-ai-canva", set(AIUse, ScopeAll, CanvaUse, ScopeAll)},
	{"configure-integrations", set(AIConfigure, ScopeAll, CanvaConfigure, ScopeAll, APIKeysManage, ScopeAll)},
	{"manage-team", set(MembersInvite, ScopeAll, MembersAssign, ScopeAll, MembersRemove, ScopeAll, MembersSSO, ScopeAll, RolesManage, ScopeAll, ActivityView, ScopeAll)},
}

// Extra permissions for the Member role of a workspace whose export profiles
// or print presets were "managed by members" before F42 (FR-11).
var (
	SeedExportProfilesTeam = SeedPermission{"export-profiles-team", set(PrintExportProfiles, ScopeAll)}
	SeedPrintPresetsTeam   = SeedPermission{"print-presets-team", set(PrintPrintPresets, ScopeAll)}
)

func allSeedKeys() []string {
	out := make([]string, len(SeedPermissions))
	for i, p := range SeedPermissions {
		out[i] = p.Key
	}
	return out
}

// SeedRoles are created in every workspace, in this order.
var SeedRoles = []SeedRole{
	{Key: "owner", Protected: true, Permissions: allSeedKeys(), LegacyRole: "owner"},
	{Key: "admin", Permissions: allSeedKeys(), LegacyRole: "admin"},
	{Key: "member", Permissions: []string{"edit-designs", "delete-designs", "download-comment", "organize-folders", "upload-files", "share", "templates", "use-ai-canva"}, LegacyRole: "member"},
	{Key: "viewer", Permissions: []string{"download-comment"}, LegacyRole: "viewer"},
}

// SeedOptions carry the pre-F42 per-workspace switches the seed reproduces.
type SeedOptions struct {
	ExportProfilesByMembers bool
	PrintPresetsByMembers   bool
}

// SeedPlan is the permissions and roles to create for one workspace.
type SeedPlan struct {
	Permissions []SeedPermission
	Roles       []SeedRole
}

// PlanSeed returns what to create in a workspace with these options.
func PlanSeed(o SeedOptions) SeedPlan {
	perms := append([]SeedPermission{}, SeedPermissions...)
	roles := make([]SeedRole, len(SeedRoles))
	for i, r := range SeedRoles {
		r.Permissions = append([]string{}, r.Permissions...)
		roles[i] = r
	}
	addToMember := func(p SeedPermission) {
		perms = append(perms, p)
		for i := range roles {
			if roles[i].Key == "member" {
				roles[i].Permissions = append(roles[i].Permissions, p.Key)
			}
		}
	}
	if o.ExportProfilesByMembers {
		addToMember(SeedExportProfilesTeam)
	}
	if o.PrintPresetsByMembers {
		addToMember(SeedPrintPresetsTeam)
	}
	return SeedPlan{Permissions: perms, Roles: roles}
}

// RoleActions resolves a seeded role's effective actions from a plan.
func (p SeedPlan) RoleActions(roleKey string) ActionSet {
	byKey := map[string]ActionSet{}
	for _, sp := range p.Permissions {
		byKey[sp.Key] = sp.Actions
	}
	for _, r := range p.Roles {
		if r.Key != roleKey {
			continue
		}
		if r.Protected {
			return Everything()
		}
		sets := make([]ActionSet, 0, len(r.Permissions))
		for _, k := range r.Permissions {
			sets = append(sets, byKey[k])
		}
		return Union(sets...)
	}
	return ActionSet{}
}
