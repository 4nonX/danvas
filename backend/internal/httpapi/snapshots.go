package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/brand"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/sharing"
)

// mountSnapshots attaches the user-facing snapshot-save route (doc 04 + doc 18).
// It is the one persistence write that runs the brand-lock validateSnapshot gate
// (a non-manage-brand saver's out-of-kit colors/fonts are rejected when a lock
// is on), which is why it lives here with both services rather than in
// mountPersistence.
func mountSnapshots(api chi.Router, p *persistence.Service, br *brand.Service, acct *accounts.Service, sh *sharing.Service) {
	api.With(requireAuth(acct)).Post("/designs/{id}/snapshots", snapshotHandler(p, br, acct, sh))
}

// templateLockGate refuses a save that changes objects a template lock
// protects (node.templateLock) when the saver may not lift that lock, judged
// against the design's current file. Writes the problem and returns false on
// a refusal. sh is nil when sharing is disabled; a design with no readable
// current file has nothing protected yet.
func templateLockGate(w http.ResponseWriter, r *http.Request, p *persistence.Service, sh *sharing.Service, id, ws, userID string, next persistence.DesignFile) bool {
	if sh == nil {
		return true
	}
	cur, err := p.LoadFile(r.Context(), id, ws)
	if err != nil || cur.File == nil {
		return true
	}
	// Judge the incoming file at the stored file's (current) version: LoadFile
	// returns it migrated, and a save labelled with an older version must not
	// be compared any less closely.
	migrated, err := persistence.MigratedCopy(next)
	if err != nil {
		persistenceProblem(w, r, fmt.Errorf("%w: %v", persistence.ErrInvalidFile, err))
		return false
	}
	if err := sh.ValidateTemplateLocks(r.Context(), id, userID, cur.File, migrated); err != nil {
		problemWithCode(w, r, http.StatusConflict, "Conflict", err.Error(), "template_locked")
		return false
	}
	return true
}

func snapshotHandler(p *persistence.Service, br *brand.Service, acct *accounts.Service, sh *sharing.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			File  persistence.DesignFile `json:"file"`
			Label string                 `json:"label"`
			Kind  string                 `json:"kind"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.File == nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "missing file", "missing_file")
			return
		}
		id := chi.URLParam(r, "id")
		ws, err := authorizeDesign(r, p, acct, id, "member")
		if err != nil {
			authProblem(w, r, err)
			return
		}
		u := userFrom(r.Context())
		// Brand-lock gate (doc 18 AC-3): reject out-of-kit values from a
		// non-manage-brand saver while a lock is on.
		if err := br.ValidateSnapshot(r.Context(), id, ws, u.ID, body.File); err != nil {
			if errors.Is(err, brand.ErrBrandLocked) {
				problemWithCode(w, r, http.StatusBadRequest, "Bad Request", err.Error(), "snapshot_failed")
				return
			}
			problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "brand validation failed", "brand_validation_failed")
			return
		}
		if !templateLockGate(w, r, p, sh, id, ws, u.ID, body.File) {
			return
		}
		// The storage layer uppercases kinds into the Postgres enum, so accept
		// any casing here too; the allowlist below compares lowercase.
		kind := persistence.SnapshotKind(strings.ToLower(body.Kind))
		switch kind {
		case "":
			if body.Label != "" {
				kind = persistence.KindNamed
			} else {
				kind = persistence.KindCheckpoint
			}
		case persistence.KindAuto, persistence.KindCheckpoint, persistence.KindNamed, persistence.KindRestore:
			// user-savable kinds
		default:
			// KindBranch is minted by the branch endpoint only; anything else
			// would fail at the enum INSERT as a 500 after the blob was stored.
			problemWithCode(w, r, http.StatusUnprocessableEntity, "Unprocessable Entity", "kind must be auto, checkpoint, named, or restore", "snapshot_kind_invalid")
			return
		}
		var label *string
		if body.Label != "" {
			label = &body.Label
		}
		rec, err := p.Snapshot(r.Context(), id, ws, body.File, kind, label, &u.ID)
		if err != nil {
			persistenceProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, rec)
	}
}
