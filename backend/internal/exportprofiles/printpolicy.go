// Print files only after approval (F47). A workspace can require that print
// files of a design (print PDF, TIFF, EPS, printing) are made only once its
// approval is granted; while approved the design is locked against edits, so
// what was approved is what prints. Roles that decide approvals are exempt
// (they approve), and roles.manage switches the policy.
package exportprofiles

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

// PrintPolicy is a workspace's print rule as one member sees it.
type PrintPolicy struct {
	RequireApproval bool `json:"requireApproval"`
	// CanChange: the caller may switch the rule (roles.manage).
	CanChange bool `json:"canChange"`
	// CanBypass: the caller decides approvals, so the rule does not hold them up.
	CanBypass bool `json:"canBypass"`
	// Approved: which of the asked-for designs are approved now.
	Approved []string `json:"approved"`
}

// ErrApprovalRequired: a print file of a design that is not approved, in a
// workspace that requires it.
var ErrApprovalRequired = errors.New("print approval required")

func (s *Service) requireApproval(ctx context.Context, workspaceID string) (bool, error) {
	var on bool
	err := s.db.QueryRow(ctx, `SELECT "require_approval_for_print" FROM "workspace_export_settings" WHERE "workspace_id" = $1`, workspaceID).Scan(&on)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return on, err
}

// approvedOf returns which of the designs (of the workspace) have a granted
// approval: the active approval's status is "approved" (a reopened one is not).
func (s *Service) approvedOf(ctx context.Context, workspaceID string, designIDs []string) ([]string, error) {
	out := []string{}
	ids := []string{}
	for _, id := range designIDs {
		if validID(id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT DISTINCT a."design_id"::text FROM "approvals" a JOIN "designs" d ON d."id" = a."design_id"
		WHERE d."workspace_id" = $1 AND a."design_id" = ANY($2::uuid[]) AND a."status" = 'approved'`, workspaceID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// GetPrintPolicy returns the workspace's rule for the caller, and which of
// `designIDs` are approved.
func (s *Service) GetPrintPolicy(ctx context.Context, userID, workspaceID string, designIDs []string) (*PrintPolicy, error) {
	if !validID(workspaceID) {
		return nil, ErrNotFound
	}
	if err := s.access.AssertMember(ctx, userID, workspaceID, "viewer"); err != nil {
		return nil, ErrForbidden
	}
	on, err := s.requireApproval(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	approved, err := s.approvedOf(ctx, workspaceID, designIDs)
	if err != nil {
		return nil, err
	}
	return &PrintPolicy{
		RequireApproval: on,
		CanChange:       s.access.Require(ctx, userID, workspaceID, authz.RolesManage, "") == nil,
		CanBypass:       s.access.Require(ctx, userID, workspaceID, authz.ApprovalDecide, "") == nil,
		Approved:        approved,
	}, nil
}

// SetPrintPolicy switches the rule (roles.manage).
func (s *Service) SetPrintPolicy(ctx context.Context, userID, workspaceID string, require bool) (*PrintPolicy, error) {
	if !validID(workspaceID) {
		return nil, ErrNotFound
	}
	if err := s.access.Require(ctx, userID, workspaceID, authz.RolesManage, ""); err != nil {
		return nil, forbidden(err)
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO "workspace_export_settings" ("workspace_id", "require_approval_for_print", "updated_by", "updated_at")
		VALUES ($1, $2, $3, now())
		ON CONFLICT ("workspace_id") DO UPDATE SET "require_approval_for_print" = $2, "updated_by" = $3, "updated_at" = now()`,
		workspaceID, require, userID); err != nil {
		return nil, err
	}
	return s.GetPrintPolicy(ctx, userID, workspaceID, nil)
}

// CheckPrint refuses a print file of a design that is not approved when the
// workspace requires it, unless the caller decides approvals.
func (s *Service) CheckPrint(ctx context.Context, userID, workspaceID, designID string) error {
	on, err := s.requireApproval(ctx, workspaceID)
	if err != nil || !on {
		return err
	}
	if s.access.Require(ctx, userID, workspaceID, authz.ApprovalDecide, "") == nil {
		return nil
	}
	approved, err := s.approvedOf(ctx, workspaceID, []string{designID})
	if err != nil {
		return err
	}
	if len(approved) == 0 {
		return ErrApprovalRequired
	}
	return nil
}
