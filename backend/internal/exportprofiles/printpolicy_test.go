package exportprofiles

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

// Print files only after approval (F47): set by roles.manage, holds members
// up until the design is approved, never holds up those who approve, and a
// reopened approval no longer counts.
func TestPrintOnlyAfterApproval(t *testing.T) {
	f := setup(t)
	design := uuid.NewString()
	if _, err := f.tx.Exec(f.ctx, `INSERT INTO "designs" (id,"workspace_id",title,"updated_at") VALUES ($1,$2,'Label',now())`, design, f.ws); err != nil {
		t.Fatal(err)
	}
	// Off by default: everyone prints.
	if err := f.svc.CheckPrint(f.ctx, f.member, f.ws, design); err != nil {
		t.Fatalf("off: %v", err)
	}
	if _, err := f.svc.SetPrintPolicy(f.ctx, f.member, f.ws, true); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member switching the rule: want forbidden, got %v", err)
	}
	p, err := f.svc.SetPrintPolicy(f.ctx, f.owner, f.ws, true)
	if err != nil || !p.RequireApproval || !p.CanChange || !p.CanBypass {
		t.Fatalf("owner switching it on: %+v %v", p, err)
	}
	if err := f.svc.CheckPrint(f.ctx, f.member, f.ws, design); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("not approved: want approval required, got %v", err)
	}
	// Who decides approvals is not held up by them.
	if err := f.svc.CheckPrint(f.ctx, f.owner, f.ws, design); err != nil {
		t.Fatalf("owner: %v", err)
	}
	approval := uuid.NewString()
	if _, err := f.tx.Exec(f.ctx, `INSERT INTO "approvals" (id,"design_id","requester_id",policy,status,"approver_ids","created_at") VALUES ($1,$2,$3,'any','pending',ARRAY[$4]::text[],now())`, approval, design, f.member, f.owner); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.CheckPrint(f.ctx, f.member, f.ws, design); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("pending: want approval required, got %v", err)
	}
	if _, err := f.tx.Exec(f.ctx, `UPDATE "approvals" SET status = 'approved', "decided_at" = now() WHERE id = $1`, approval); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.CheckPrint(f.ctx, f.member, f.ws, design); err != nil {
		t.Fatalf("approved: %v", err)
	}
	got, err := f.svc.GetPrintPolicy(f.ctx, f.member, f.ws, []string{design, uuid.NewString(), "not-an-id"})
	if err != nil || !got.RequireApproval || got.CanChange || got.CanBypass || len(got.Approved) != 1 || got.Approved[0] != design {
		t.Fatalf("member's view: %+v %v", got, err)
	}
	if _, err := f.tx.Exec(f.ctx, `UPDATE "approvals" SET status = 'reopened' WHERE id = $1`, approval); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.CheckPrint(f.ctx, f.member, f.ws, design); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("reopened: want approval required, got %v", err)
	}
	// Outsiders learn nothing.
	if _, err := f.svc.GetPrintPolicy(f.ctx, f.stranger, f.ws, nil); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger: %v", err)
	}
}
