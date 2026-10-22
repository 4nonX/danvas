// Names and explanations of workspace actions, permissions and roles (F42),
// in the reader's language. Every catalog key is written out, so the i18n
// checks see each one. Seeded permissions and roles show their translated
// name until someone renames them (the server then sends the name). The
// "fonts" keys are quoted so the schema-value check does not take them for a
// font field.

import type { Action, ActionArea } from "@hc/sdk";
import { tr } from "@/lib/i18n";

export const actionLabel = (): Record<Action, string> => ({
  "design.create": tr("roles.action_design_create"),
  "design.rename": tr("roles.action_design_rename"),
  "design.edit": tr("roles.action_design_edit"),
  "design.trash": tr("roles.action_design_trash"),
  "design.restore": tr("roles.action_design_restore"),
  "design.purge": tr("roles.action_design_purge"),
  "design.download": tr("roles.action_design_download"),
  "design.comment": tr("roles.action_design_comment"),
  "design.present": tr("roles.action_design_present"),
  "comment.moderate": tr("roles.action_comment_moderate"),
  "folder.create": tr("roles.action_folder_create"),
  "folder.edit": tr("roles.action_folder_edit"),
  "folder.delete": tr("roles.action_folder_delete"),
  "folder.defaults": tr("roles.action_folder_defaults"),
  "asset.upload": tr("roles.action_asset_upload"),
  "asset.edit": tr("roles.action_asset_edit"),
  "asset.delete": tr("roles.action_asset_delete"),
  "share.team": tr("roles.action_share_team"),
  "share.external": tr("roles.action_share_external"),
  "share.requests": tr("roles.action_share_requests"),
  "approval.request": tr("roles.action_approval_request"),
  "approval.decide": tr("roles.action_approval_decide"),
  "template.publish": tr("roles.action_template_publish"),
  "template.publishPublic": tr("roles.action_template_publish_public"),
  "template.delete": tr("roles.action_template_delete"),
  "template.collections": tr("roles.action_template_collections"),
  "brand.kits": tr("roles.action_brand_kits"),
  "brand.designs": tr("roles.action_brand_designs"),
  "brand.unlock": tr("roles.action_brand_unlock"),
  "print.colorProfiles": tr("roles.action_print_color_profiles"),
  "print.exportProfiles": tr("roles.action_print_export_profiles"),
  "print.printPresets": tr("roles.action_print_print_presets"),
  "fonts.manage": tr("roles.action_fonts_manage"),
  "ai.use": tr("roles.action_ai_use"),
  "ai.configure": tr("roles.action_ai_configure"),
  "canva.use": tr("roles.action_canva_use"),
  "canva.configure": tr("roles.action_canva_configure"),
  "apiKeys.manage": tr("roles.action_api_keys_manage"),
  "members.invite": tr("roles.action_members_invite"),
  "members.assign": tr("roles.action_members_assign"),
  "members.remove": tr("roles.action_members_remove"),
  "members.sso": tr("roles.action_members_sso"),
  "roles.manage": tr("roles.action_roles_manage"),
  "activity.view": tr("roles.action_activity_view"),
});

export const actionHint = (): Record<Action, string> => ({
  "design.create": tr("roles.hint_design_create"),
  "design.rename": tr("roles.hint_design_rename"),
  "design.edit": tr("roles.hint_design_edit"),
  "design.trash": tr("roles.hint_design_trash"),
  "design.restore": tr("roles.hint_design_restore"),
  "design.purge": tr("roles.hint_design_purge"),
  "design.download": tr("roles.hint_design_download"),
  "design.comment": tr("roles.hint_design_comment"),
  "design.present": tr("roles.hint_design_present"),
  "comment.moderate": tr("roles.hint_comment_moderate"),
  "folder.create": tr("roles.hint_folder_create"),
  "folder.edit": tr("roles.hint_folder_edit"),
  "folder.delete": tr("roles.hint_folder_delete"),
  "folder.defaults": tr("roles.hint_folder_defaults"),
  "asset.upload": tr("roles.hint_asset_upload"),
  "asset.edit": tr("roles.hint_asset_edit"),
  "asset.delete": tr("roles.hint_asset_delete"),
  "share.team": tr("roles.hint_share_team"),
  "share.external": tr("roles.hint_share_external"),
  "share.requests": tr("roles.hint_share_requests"),
  "approval.request": tr("roles.hint_approval_request"),
  "approval.decide": tr("roles.hint_approval_decide"),
  "template.publish": tr("roles.hint_template_publish"),
  "template.publishPublic": tr("roles.hint_template_publish_public"),
  "template.delete": tr("roles.hint_template_delete"),
  "template.collections": tr("roles.hint_template_collections"),
  "brand.kits": tr("roles.hint_brand_kits"),
  "brand.designs": tr("roles.hint_brand_designs"),
  "brand.unlock": tr("roles.hint_brand_unlock"),
  "print.colorProfiles": tr("roles.hint_print_color_profiles"),
  "print.exportProfiles": tr("roles.hint_print_export_profiles"),
  "print.printPresets": tr("roles.hint_print_print_presets"),
  "fonts.manage": tr("roles.hint_fonts_manage"),
  "ai.use": tr("roles.hint_ai_use"),
  "ai.configure": tr("roles.hint_ai_configure"),
  "canva.use": tr("roles.hint_canva_use"),
  "canva.configure": tr("roles.hint_canva_configure"),
  "apiKeys.manage": tr("roles.hint_api_keys_manage"),
  "members.invite": tr("roles.hint_members_invite"),
  "members.assign": tr("roles.hint_members_assign"),
  "members.remove": tr("roles.hint_members_remove"),
  "members.sso": tr("roles.hint_members_sso"),
  "roles.manage": tr("roles.hint_roles_manage"),
  "activity.view": tr("roles.hint_activity_view"),
});

export const areaLabel = (): Record<ActionArea, string> => ({
  designs: tr("roles.area_designs"),
  folders: tr("roles.area_folders"),
  uploads: tr("roles.area_uploads"),
  sharing: tr("roles.area_sharing"),
  approvals: tr("roles.area_approvals"),
  templates: tr("roles.area_templates"),
  brand: tr("roles.area_brand"),
  print: tr("roles.area_print"),
  "fonts": tr("roles.area_fonts"),
  ai: tr("roles.area_ai"),
  integrations: tr("roles.area_integrations"),
  team: tr("roles.area_team"),
});

const seededPermissionName = (): Record<string, string> => ({
  "edit-designs": tr("roles.seed_permission_edit_designs"),
  "delete-designs": tr("roles.seed_permission_delete_designs"),
  "download-comment": tr("roles.seed_permission_download_comment"),
  "moderate-comments": tr("roles.seed_permission_moderate_comments"),
  "organize-folders": tr("roles.seed_permission_organize_folders"),
  "folder-defaults": tr("roles.seed_permission_folder_defaults"),
  "upload-files": tr("roles.seed_permission_upload_files"),
  share: tr("roles.seed_permission_share"),
  approve: tr("roles.seed_permission_approve"),
  templates: tr("roles.seed_permission_templates"),
  "manage-templates": tr("roles.seed_permission_manage_templates"),
  brand: tr("roles.seed_permission_brand"),
  "print-data": tr("roles.seed_permission_print_data"),
  "fonts": tr("roles.seed_permission_fonts"),
  "use-ai-canva": tr("roles.seed_permission_use_ai_canva"),
  "configure-integrations": tr("roles.seed_permission_configure_integrations"),
  "manage-team": tr("roles.seed_permission_manage_team"),
  "export-profiles-team": tr("roles.seed_permission_export_profiles_team"),
  "print-presets-team": tr("roles.seed_permission_print_presets_team"),
});

const seededRoleName = (): Record<string, string> => ({
  owner: tr("roles.seed_role_owner"),
  admin: tr("roles.seed_role_admin"),
  member: tr("roles.seed_role_member"),
  viewer: tr("roles.seed_role_viewer"),
});

const seededRoleHint = (): Record<string, string> => ({
  owner: tr("roles.seed_role_owner_hint"),
  admin: tr("roles.seed_role_admin_hint"),
  member: tr("roles.seed_role_member_hint"),
  viewer: tr("roles.seed_role_viewer_hint"),
});

/** A permission's display name: its own, else its seeded one translated. */
export function permissionName(p: { name: string; seedKey?: string }): string {
  return p.name || (p.seedKey && seededPermissionName()[p.seedKey]) || p.seedKey || "";
}

/** A role's display name: its own, else its seeded one translated. */
export function roleName(r: { name: string; seedKey?: string }): string {
  return r.name || (r.seedKey && seededRoleName()[r.seedKey]) || r.seedKey || "";
}

/** A role's description: its own, else the seeded role's, translated. */
export function roleHint(r: { description: string; seedKey?: string }): string {
  return r.description || (r.seedKey && seededRoleHint()[r.seedKey]) || "";
}
