// Package canva imports designs from Canva through its Connect API
// (docs/roadmap/41-canva-import.md).
//
// Each workspace registers its own Canva integration (Client ID + secret from
// Canva's developer portal), and each member connects their own Canva account
// through OAuth 2.0 with PKCE. Every Canva call goes through here: the client
// secret, the PKCE verifier and the tokens never reach the browser, and all of
// them are encrypted at rest (AES-256-GCM, key from AI_SECRET, like AI keys).
//
// The browser drives the import (list a folder, start an export, poll it,
// download the file, import it with the existing importers); every step here
// is one short Canva call, so nothing long runs inside a request.
package canva

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"hycanvas/backend/internal/auth/secrets"
)

// Scopes the integration needs; they must also be enabled on the Canva side.
var Scopes = []string{"folder:read", "design:content:read", "profile:read"}

// CallbackPath is the OAuth redirect path under the instance's origin.
const CallbackPath = "/api/v1/canva/callback"

// stateTTL bounds how long a connect may take between leaving for Canva and
// coming back.
const stateTTL = 15 * time.Minute

// maxDownload bounds one exported file (a long deck as PPTX stays far below).
const maxDownload = 1 << 30

var (
	ErrNotConfigured  = errors.New("canva integration not configured")
	ErrNotConnected   = errors.New("canva account not connected")
	ErrSecretRequired = errors.New("client secret required")
	ErrBadRequest     = errors.New("invalid canva request")
	ErrStateInvalid   = errors.New("invalid or expired connect state")
	// ErrNoExport is a design Canva offers neither PPTX nor PNG for.
	ErrNoExport = errors.New("design cannot be exported")
	// ErrUpstream is a Canva call that failed for another reason.
	ErrUpstream = errors.New("canva request failed")
)

// RateLimitError is Canva's 429: wait RetryAfter, then try again. Daily is set
// when Canva says the daily allowance is used up.
type RateLimitError struct {
	RetryAfter time.Duration
	Daily      bool
}

func (e *RateLimitError) Error() string { return "canva rate limit" }

// DBTX is the query surface (satisfied by *pgxpool.Pool and pgx.Tx).
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Service is the Canva module.
type Service struct {
	db     DBTX
	secret string
	client *http.Client
	// Canva's endpoints; replaced in tests.
	apiBase  string // https://api.canva.com/rest
	authBase string // https://www.canva.com/api/oauth/authorize
	// allowDownload judges an export download URL (Canva's own HTTPS hosts).
	allowDownload func(*url.URL) bool

	refreshMu sync.Map // connection key -> *sync.Mutex
}

// NewService wires the module. secret is the AES key material (AI_SECRET).
func NewService(db DBTX, secret string) *Service {
	return &Service{
		db:            db,
		secret:        secret,
		client:        &http.Client{Timeout: 60 * time.Second},
		apiBase:       "https://api.canva.com/rest",
		authBase:      "https://www.canva.com/api/oauth/authorize",
		allowDownload: canvaHost,
	}
}

// canvaHost accepts only HTTPS URLs on canva.com and its subdomains (export
// downloads come from export-download.canva.com).
func canvaHost(u *url.URL) bool {
	h := strings.ToLower(u.Hostname())
	return u.Scheme == "https" && (h == "canva.com" || strings.HasSuffix(h, ".canva.com"))
}

// --- secrets ----------------------------------------------------------------

func (s *Service) seal(plain string) (secrets.Encrypted, error) {
	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return secrets.Encrypted{}, err
	}
	return secrets.EncryptAISecret(plain, s.secret, nonce)
}

func (s *Service) open(c, iv, tag string) (string, error) {
	return secrets.DecryptAISecret(secrets.Encrypted{Cipher: c, IV: iv, Tag: tag}, s.secret)
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// --- integration (admin) ------------------------------------------------------

// IntegrationView is what the settings show: never the secret.
type IntegrationView struct {
	Configured bool     `json:"configured"`
	ClientID   string   `json:"clientId"`
	Scopes     []string `json:"scopes"`
}

type integration struct {
	clientID, clientSecret string
}

func (s *Service) integration(ctx context.Context, workspaceID string) (*integration, error) {
	var id, c, iv, tag string
	err := s.db.QueryRow(ctx, `SELECT "client_id","secret_cipher","secret_iv","secret_tag" FROM "canva_integrations" WHERE "workspace_id" = $1`, workspaceID).Scan(&id, &c, &iv, &tag)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotConfigured
	}
	if err != nil {
		return nil, err
	}
	sec, err := s.open(c, iv, tag)
	if err != nil {
		return nil, err
	}
	return &integration{clientID: id, clientSecret: sec}, nil
}

// GetIntegration returns the workspace's integration settings.
func (s *Service) GetIntegration(ctx context.Context, workspaceID string) (IntegrationView, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT "client_id" FROM "canva_integrations" WHERE "workspace_id" = $1`, workspaceID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return IntegrationView{Scopes: Scopes}, nil
	}
	if err != nil {
		return IntegrationView{}, err
	}
	return IntegrationView{Configured: true, ClientID: id, Scopes: Scopes}, nil
}

// SetIntegration stores the Client ID and (when given) the secret. A new
// Client ID needs its secret, and drops every connection made through the old
// one: their tokens belong to that integration.
func (s *Service) SetIntegration(ctx context.Context, workspaceID, clientID, clientSecret string) (IntegrationView, error) {
	clientID = strings.TrimSpace(clientID)
	clientSecret = strings.TrimSpace(clientSecret)
	if clientID == "" || len(clientID) > 200 || len(clientSecret) > 500 {
		return IntegrationView{}, ErrBadRequest
	}
	cur, err := s.GetIntegration(ctx, workspaceID)
	if err != nil {
		return IntegrationView{}, err
	}
	changed := !cur.Configured || cur.ClientID != clientID
	if changed && clientSecret == "" {
		return IntegrationView{}, ErrSecretRequired
	}
	if clientSecret == "" {
		return cur, nil // nothing to change
	}
	enc, err := s.seal(clientSecret)
	if err != nil {
		return IntegrationView{}, err
	}
	const q = `INSERT INTO "canva_integrations" ("workspace_id","client_id","secret_cipher","secret_iv","secret_tag","updated_at")
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT ("workspace_id") DO UPDATE SET "client_id" = EXCLUDED."client_id",
			"secret_cipher" = EXCLUDED."secret_cipher", "secret_iv" = EXCLUDED."secret_iv",
			"secret_tag" = EXCLUDED."secret_tag", "updated_at" = now()`
	if _, err := s.db.Exec(ctx, q, workspaceID, clientID, enc.Cipher, enc.IV, enc.Tag); err != nil {
		return IntegrationView{}, err
	}
	if changed && cur.Configured {
		if _, err := s.db.Exec(ctx, `DELETE FROM "canva_connections" WHERE "workspace_id" = $1`, workspaceID); err != nil {
			return IntegrationView{}, err
		}
	}
	return s.GetIntegration(ctx, workspaceID)
}

// DeleteIntegration removes the integration and every connection through it.
func (s *Service) DeleteIntegration(ctx context.Context, workspaceID string) error {
	for _, q := range []string{
		`DELETE FROM "canva_connections" WHERE "workspace_id" = $1`,
		`DELETE FROM "canva_oauth_states" WHERE "workspace_id" = $1`,
		`DELETE FROM "canva_integrations" WHERE "workspace_id" = $1`,
	} {
		if _, err := s.db.Exec(ctx, q, workspaceID); err != nil {
			return err
		}
	}
	return nil
}

// --- connection (per member) ---------------------------------------------------

// ConnectionView is a member's connection state.
type ConnectionView struct {
	Configured  bool   `json:"configured"`
	Connected   bool   `json:"connected"`
	DisplayName string `json:"displayName,omitempty"`
}

// Connection reports whether the caller has connected Canva in this workspace.
func (s *Service) Connection(ctx context.Context, workspaceID, userID string) (ConnectionView, error) {
	in, err := s.GetIntegration(ctx, workspaceID)
	if err != nil {
		return ConnectionView{}, err
	}
	var name string
	err = s.db.QueryRow(ctx, `SELECT "display_name" FROM "canva_connections" WHERE "workspace_id" = $1 AND "user_id" = $2`, workspaceID, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConnectionView{Configured: in.Configured}, nil
	}
	if err != nil {
		return ConnectionView{}, err
	}
	return ConnectionView{Configured: in.Configured, Connected: true, DisplayName: name}, nil
}

// StartConnect returns the Canva authorization URL for the caller. The PKCE
// verifier and the state are stored server-side for FinishConnect.
// redirectURI must be what is registered in Canva (this instance's
// CallbackPath); returnTo is the app path to land on afterwards.
func (s *Service) StartConnect(ctx context.Context, workspaceID, userID, redirectURI, returnTo string) (string, error) {
	in, err := s.integration(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	verifier, err := randomToken(48) // 64 characters, within PKCE's 43..128
	if err != nil {
		return "", err
	}
	state, err := randomToken(32)
	if err != nil {
		return "", err
	}
	enc, err := s.seal(verifier)
	if err != nil {
		return "", err
	}
	// Abandoned connects do not pile up.
	if _, err := s.db.Exec(ctx, `DELETE FROM "canva_oauth_states" WHERE "created_at" < now() - make_interval(mins => $1)`, int(stateTTL/time.Minute)); err != nil {
		return "", err
	}
	const q = `INSERT INTO "canva_oauth_states" ("state","workspace_id","user_id","verifier_cipher","verifier_iv","verifier_tag","redirect_uri","return_to")
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, q, state, workspaceID, userID, enc.Cipher, enc.IV, enc.Tag, redirectURI, SafeReturnTo(returnTo)); err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	v := url.Values{}
	v.Set("code_challenge", base64.RawURLEncoding.EncodeToString(sum[:]))
	v.Set("code_challenge_method", "S256")
	v.Set("scope", strings.Join(Scopes, " "))
	v.Set("response_type", "code")
	v.Set("client_id", in.clientID)
	v.Set("state", state)
	v.Set("redirect_uri", redirectURI)
	return s.authBase + "?" + v.Encode(), nil
}

// SafeReturnTo keeps a return path inside the app: a single leading slash, no
// scheme, no protocol-relative "//host".
func SafeReturnTo(p string) string {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.ContainsAny(p, "\\\r\n") || len(p) > 300 {
		return "/dashboard/"
	}
	return p
}

// FinishConnect completes the OAuth flow for the caller: it checks the state
// (same user, not expired, used once), exchanges the code and stores the
// tokens. It returns the path to send the browser to.
func (s *Service) FinishConnect(ctx context.Context, userID, state, code string) (string, error) {
	if state == "" || code == "" {
		return "", ErrStateInvalid
	}
	var ws, owner, c, iv, tag, redirectURI, returnTo string
	var created time.Time
	err := s.db.QueryRow(ctx, `DELETE FROM "canva_oauth_states" WHERE "state" = $1
		RETURNING "workspace_id","user_id","verifier_cipher","verifier_iv","verifier_tag","redirect_uri","return_to","created_at"`, state).
		Scan(&ws, &owner, &c, &iv, &tag, &redirectURI, &returnTo, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrStateInvalid
	}
	if err != nil {
		return "", err
	}
	if owner != userID || time.Since(created) > stateTTL {
		return "", ErrStateInvalid
	}
	verifier, err := s.open(c, iv, tag)
	if err != nil {
		return "", err
	}
	in, err := s.integration(ctx, ws)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("code_verifier", verifier)
	form.Set("redirect_uri", redirectURI)
	tok, err := s.tokenRequest(ctx, in, form)
	if err != nil {
		return "", err
	}
	name := s.displayName(ctx, tok.AccessToken)
	if err := s.storeTokens(ctx, ws, userID, name, tok); err != nil {
		return "", err
	}
	return returnTo, nil
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

func (s *Service) tokenRequest(ctx context.Context, in *integration, form url.Values) (*tokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiBase+"/v1/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(in.clientID, in.clientSecret)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: token: %v", ErrUpstream, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK {
		slog.Warn("canva token request refused", "status", res.StatusCode, "reason", upstreamReason(body))
		if res.StatusCode == http.StatusBadRequest || res.StatusCode == http.StatusUnauthorized {
			return nil, ErrNotConnected
		}
		return nil, ErrUpstream
	}
	var t tokenResponse
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" || t.RefreshToken == "" {
		return nil, ErrUpstream
	}
	return &t, nil
}

func (s *Service) displayName(ctx context.Context, access string) string {
	var p struct {
		Profile struct {
			DisplayName string `json:"display_name"`
		} `json:"profile"`
	}
	if err := s.getJSON(ctx, access, "/v1/users/me/profile", &p); err != nil {
		return ""
	}
	return p.Profile.DisplayName
}

func (s *Service) storeTokens(ctx context.Context, ws, userID, name string, t *tokenResponse) error {
	a, err := s.seal(t.AccessToken)
	if err != nil {
		return err
	}
	r, err := s.seal(t.RefreshToken)
	if err != nil {
		return err
	}
	ttl := time.Duration(t.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = time.Hour
	}
	const q = `INSERT INTO "canva_connections" ("workspace_id","user_id","display_name","access_cipher","access_iv","access_tag",
			"refresh_cipher","refresh_iv","refresh_tag","expires_at","updated_at")
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
		ON CONFLICT ("workspace_id","user_id") DO UPDATE SET
			"display_name" = CASE WHEN EXCLUDED."display_name" = '' THEN "canva_connections"."display_name" ELSE EXCLUDED."display_name" END,
			"access_cipher" = EXCLUDED."access_cipher", "access_iv" = EXCLUDED."access_iv", "access_tag" = EXCLUDED."access_tag",
			"refresh_cipher" = EXCLUDED."refresh_cipher", "refresh_iv" = EXCLUDED."refresh_iv", "refresh_tag" = EXCLUDED."refresh_tag",
			"expires_at" = EXCLUDED."expires_at", "updated_at" = now()`
	_, err = s.db.Exec(ctx, q, ws, userID, name, a.Cipher, a.IV, a.Tag, r.Cipher, r.IV, r.Tag, time.Now().Add(ttl))
	return err
}

// Disconnect forgets the caller's Canva connection (and asks Canva to revoke
// the refresh token, best effort).
func (s *Service) Disconnect(ctx context.Context, workspaceID, userID string) error {
	var c, iv, tag string
	err := s.db.QueryRow(ctx, `SELECT "refresh_cipher","refresh_iv","refresh_tag" FROM "canva_connections" WHERE "workspace_id" = $1 AND "user_id" = $2`, workspaceID, userID).Scan(&c, &iv, &tag)
	if err == nil {
		if in, ierr := s.integration(ctx, workspaceID); ierr == nil {
			if refresh, oerr := s.open(c, iv, tag); oerr == nil {
				form := url.Values{}
				form.Set("token", refresh)
				if req, rerr := http.NewRequestWithContext(ctx, http.MethodPost, s.apiBase+"/v1/oauth/revoke", strings.NewReader(form.Encode())); rerr == nil {
					req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
					req.SetBasicAuth(in.clientID, in.clientSecret)
					if res, derr := s.client.Do(req); derr == nil {
						res.Body.Close()
					}
				}
			}
		}
	}
	_, err = s.db.Exec(ctx, `DELETE FROM "canva_connections" WHERE "workspace_id" = $1 AND "user_id" = $2`, workspaceID, userID)
	return err
}

// accessToken returns a valid access token for the caller, refreshing it when
// it is about to expire. Refreshes are serialized per connection because
// Canva's refresh tokens are single-use: two parallel refreshes would spend
// the same one and lock the user out.
func (s *Service) accessToken(ctx context.Context, ws, userID string) (string, error) {
	key := ws + "/" + userID
	m, _ := s.refreshMu.LoadOrStore(key, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	var ac, aiv, atag, rc, riv, rtag string
	var expires time.Time
	err := s.db.QueryRow(ctx, `SELECT "access_cipher","access_iv","access_tag","refresh_cipher","refresh_iv","refresh_tag","expires_at"
		FROM "canva_connections" WHERE "workspace_id" = $1 AND "user_id" = $2`, ws, userID).Scan(&ac, &aiv, &atag, &rc, &riv, &rtag, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotConnected
	}
	if err != nil {
		return "", err
	}
	if time.Until(expires) > 2*time.Minute {
		return s.open(ac, aiv, atag)
	}
	in, err := s.integration(ctx, ws)
	if err != nil {
		return "", err
	}
	refresh, err := s.open(rc, riv, rtag)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refresh)
	tok, err := s.tokenRequest(ctx, in, form)
	if errors.Is(err, ErrNotConnected) {
		// The refresh token is no longer valid (revoked, or the app was
		// removed in Canva): forget it, the user connects again.
		_, _ = s.db.Exec(ctx, `DELETE FROM "canva_connections" WHERE "workspace_id" = $1 AND "user_id" = $2`, ws, userID)
		return "", ErrNotConnected
	}
	if err != nil {
		return "", err
	}
	if err := s.storeTokens(ctx, ws, userID, "", tok); err != nil {
		return "", err
	}
	return tok.AccessToken, nil
}

// --- Canva REST calls -------------------------------------------------------------

func (s *Service) do(ctx context.Context, access, method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, method, s.apiBase+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	switch {
	case res.StatusCode == http.StatusTooManyRequests:
		reason := upstreamReason(raw)
		return &RateLimitError{RetryAfter: retryAfter(res.Header.Get("Retry-After")), Daily: strings.Contains(strings.ToLower(reason), "daily")}
	case res.StatusCode == http.StatusUnauthorized:
		return ErrNotConnected
	case res.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%w: not found", ErrBadRequest)
	case res.StatusCode >= 300:
		slog.Warn("canva request refused", "path", path, "status", res.StatusCode, "reason", upstreamReason(raw))
		return ErrUpstream
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%w: bad response", ErrUpstream)
	}
	return nil
}

func (s *Service) getJSON(ctx context.Context, access, path string, out any) error {
	return s.do(ctx, access, http.MethodGet, path, nil, out)
}

func retryAfter(h string) time.Duration {
	if n, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return time.Minute
}

// upstreamReason is Canva's own error message, bounded, for the server log.
func upstreamReason(raw []byte) string {
	var j struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &j)
	r := strings.TrimSpace(j.Code + " " + j.Message)
	if r == "" {
		r = string(raw)
	}
	if len(r) > 300 {
		r = r[:300]
	}
	return r
}

// Item is one entry of a Canva folder.
type Item struct {
	Type      string `json:"type"` // "folder" or "design"
	ID        string `json:"id"`
	Name      string `json:"name"`
	PageCount int    `json:"pageCount,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`
	UpdatedAt int64  `json:"updatedAt,omitempty"`
}

// FolderPage is one page of a folder listing.
type FolderPage struct {
	Items        []Item `json:"items"`
	Continuation string `json:"continuation,omitempty"`
}

// validID keeps Canva ids inside one path segment.
func validID(id string) bool {
	if id == "" || len(id) > 200 {
		return false
	}
	for _, r := range id {
		if !(r == '-' || r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')) {
			return false
		}
	}
	return true
}

// ListFolder lists the folders and designs of one Canva folder ("root" is the
// top of the user's projects), by title.
func (s *Service) ListFolder(ctx context.Context, ws, userID, folderID, continuation string) (FolderPage, error) {
	if !validID(folderID) || len(continuation) > 2000 {
		return FolderPage{}, ErrBadRequest
	}
	access, err := s.accessToken(ctx, ws, userID)
	if err != nil {
		return FolderPage{}, err
	}
	q := url.Values{}
	q.Set("item_types", "design,folder")
	q.Set("sort_by", "title_ascending")
	q.Set("limit", "100")
	if continuation != "" {
		q.Set("continuation", continuation)
	}
	var raw struct {
		Items []struct {
			Type   string `json:"type"`
			Folder *struct {
				ID        string `json:"id"`
				Name      string `json:"name"`
				UpdatedAt int64  `json:"updated_at"`
			} `json:"folder"`
			Design *struct {
				ID        string `json:"id"`
				Title     string `json:"title"`
				PageCount int    `json:"page_count"`
				UpdatedAt int64  `json:"updated_at"`
				Thumbnail *struct {
					URL string `json:"url"`
				} `json:"thumbnail"`
			} `json:"design"`
		} `json:"items"`
		Continuation string `json:"continuation"`
	}
	if err := s.getJSON(ctx, access, "/v1/folders/"+url.PathEscape(folderID)+"/items?"+q.Encode(), &raw); err != nil {
		return FolderPage{}, err
	}
	out := FolderPage{Items: []Item{}, Continuation: raw.Continuation}
	for _, it := range raw.Items {
		switch {
		case it.Type == "folder" && it.Folder != nil:
			out.Items = append(out.Items, Item{Type: "folder", ID: it.Folder.ID, Name: it.Folder.Name, UpdatedAt: it.Folder.UpdatedAt})
		case it.Type == "design" && it.Design != nil:
			d := Item{Type: "design", ID: it.Design.ID, Name: it.Design.Title, PageCount: it.Design.PageCount, UpdatedAt: it.Design.UpdatedAt}
			if it.Design.Thumbnail != nil {
				d.Thumbnail = it.Design.Thumbnail.URL
			}
			out.Items = append(out.Items, d)
		}
	}
	return out, nil
}

// Export is a started export job and the format chosen for it.
type Export struct {
	JobID  string `json:"jobId"`
	Format string `json:"format"` // "pptx" (editable) or "png" (one image per page)
}

// StartExport starts the export of one design: PPTX when Canva offers it for
// every page, PNG pages otherwise.
func (s *Service) StartExport(ctx context.Context, ws, userID, designID string) (Export, error) {
	if !validID(designID) {
		return Export{}, ErrBadRequest
	}
	access, err := s.accessToken(ctx, ws, userID)
	if err != nil {
		return Export{}, err
	}
	var formats struct {
		Formats map[string]struct {
			PageNumbers []int `json:"page_numbers"`
		} `json:"formats"`
	}
	if err := s.getJSON(ctx, access, "/v1/designs/"+url.PathEscape(designID)+"/export-formats", &formats); err != nil {
		return Export{}, err
	}
	format := "png"
	if f, ok := formats.Formats["pptx"]; ok && len(f.PageNumbers) == 0 {
		format = "pptx" // no page list: every page supports it
	} else if _, ok := formats.Formats["png"]; !ok {
		return Export{}, ErrNoExport
	}
	var job struct {
		Job struct {
			ID string `json:"id"`
		} `json:"job"`
	}
	body := map[string]any{"design_id": designID, "format": map[string]any{"type": format}}
	if err := s.do(ctx, access, http.MethodPost, "/v1/exports", body, &job); err != nil {
		return Export{}, err
	}
	if job.Job.ID == "" {
		return Export{}, ErrUpstream
	}
	return Export{JobID: job.Job.ID, Format: format}, nil
}

// ExportStatus is an export job's state.
type ExportStatus struct {
	Status string `json:"status"` // in_progress, success, failed
	Files  int    `json:"files"`
	Error  string `json:"error,omitempty"` // Canva's code on failure
}

type exportJob struct {
	Job struct {
		Status string   `json:"status"`
		URLs   []string `json:"urls"`
		Error  *struct {
			Code string `json:"code"`
		} `json:"error"`
	} `json:"job"`
}

func (s *Service) job(ctx context.Context, ws, userID, jobID string) (*exportJob, error) {
	if !validID(jobID) {
		return nil, ErrBadRequest
	}
	access, err := s.accessToken(ctx, ws, userID)
	if err != nil {
		return nil, err
	}
	var j exportJob
	if err := s.getJSON(ctx, access, "/v1/exports/"+url.PathEscape(jobID), &j); err != nil {
		return nil, err
	}
	return &j, nil
}

// GetExport reports an export job's state.
func (s *Service) GetExport(ctx context.Context, ws, userID, jobID string) (ExportStatus, error) {
	j, err := s.job(ctx, ws, userID, jobID)
	if err != nil {
		return ExportStatus{}, err
	}
	st := ExportStatus{Status: j.Job.Status, Files: len(j.Job.URLs)}
	if j.Job.Error != nil {
		st.Error = j.Job.Error.Code
	}
	return st, nil
}

// ExportFile opens the index-th file of a finished export job. The caller
// streams it to the browser and closes it. Only Canva's own HTTPS hosts are
// fetched.
func (s *Service) ExportFile(ctx context.Context, ws, userID, jobID string, index int) (io.ReadCloser, string, error) {
	j, err := s.job(ctx, ws, userID, jobID)
	if err != nil {
		return nil, "", err
	}
	if j.Job.Status != "success" || index < 0 || index >= len(j.Job.URLs) {
		return nil, "", ErrBadRequest
	}
	u, err := url.Parse(j.Job.URLs[index])
	if err != nil || !s.allowDownload(u) {
		return nil, "", fmt.Errorf("%w: unexpected download host", ErrUpstream)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	dl := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(r *http.Request, _ []*http.Request) error {
		if !s.allowDownload(r.URL) {
			return errors.New("redirect off canva")
		}
		return nil
	}}
	res, err := dl.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("%w: download: %v", ErrUpstream, err)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, "", fmt.Errorf("%w: download status %d", ErrUpstream, res.StatusCode)
	}
	return limitedBody{Reader: io.LimitReader(res.Body, maxDownload), Closer: res.Body}, res.Header.Get("Content-Type"), nil
}

type limitedBody struct {
	io.Reader
	io.Closer
}

// --- import records -----------------------------------------------------------------

// Imported maps Canva design ids to the danvas designs made from them, for
// designs that still exist (not in the trash).
func (s *Service) Imported(ctx context.Context, ws string) (map[string]string, error) {
	rows, err := s.db.Query(ctx, `SELECT i."canva_design_id", i."design_id"::text FROM "canva_imports" i
		JOIN "designs" d ON d.id = i."design_id" AND d."deleted_at" IS NULL WHERE i."workspace_id" = $1`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var c, d string
		if err := rows.Scan(&c, &d); err != nil {
			return nil, err
		}
		out[c] = d
	}
	return out, rows.Err()
}

// RecordImport remembers that a Canva design became a danvas design of the
// same workspace (a later import of it replaces the record).
func (s *Service) RecordImport(ctx context.Context, ws, canvaDesignID, designID string) error {
	if !validID(canvaDesignID) {
		return ErrBadRequest
	}
	tag, err := s.db.Exec(ctx, `INSERT INTO "canva_imports" ("workspace_id","canva_design_id","design_id")
		SELECT $1, $2, d.id FROM "designs" d WHERE d.id = $3::uuid AND d."workspace_id" = $1
		ON CONFLICT ("workspace_id","canva_design_id") DO UPDATE SET "design_id" = EXCLUDED."design_id", "imported_at" = now()`,
		ws, canvaDesignID, designID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrBadRequest // not a design of this workspace
	}
	return nil
}
