package ai

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// What a provider's refusal means for the person who has to fix it. The HTTP
// status alone does not say: OpenAI answers an empty account with 429 like a
// rate limit, Anthropic with 400 like a malformed request, Google with 429
// RESOURCE_EXHAUSTED for both a daily quota and a per-minute limit, xAI with
// 403 like a wrong key. Each sentinel rides alongside ErrBadGateway, so the
// API names the real cause instead of advising to wait for an account that
// has no credit.
var (
	// ErrQuotaExhausted: no credit left, or the plan's quota is used up.
	// Waiting does not help; the fix is in the provider's billing.
	ErrQuotaExhausted = errors.New("the provider account has no credit or quota left")
	// ErrRateLimited: too many requests in a short time; waiting helps.
	ErrRateLimited = errors.New("the provider rate-limited the request")
	// ErrProviderBusy: the provider is overloaded or failed on its side.
	ErrProviderBusy = errors.New("the provider is overloaded or failed on its side")
	// ErrProviderTimeout: the provider did not answer within the deadline.
	ErrProviderTimeout = errors.New("the provider did not answer in time")
	// ErrContentRefused: the provider's content rules refused the request.
	ErrContentRefused = errors.New("the provider refused the request under its content rules")
	// ErrRequestTooLarge: more than the model takes at once (context length).
	ErrRequestTooLarge = errors.New("the request is too large for the model")
)

// upstreamDetail reads a provider's error body: the human-readable reason for
// the log (bounded, one line) and the machine code it carries, if any. The
// shapes covered: {"error":{"message","type","code","status"}} (OpenAI and
// compatible APIs, Anthropic, Google), {"message","code"} and AWS's
// {"message"|"Message","__type"}, and {"error":"text"}. The raw body,
// lowercased and bounded, is returned as well for classification. None of it
// is ever returned to a client.
func upstreamDetail(r io.Reader) (reason, code, raw string) {
	b, _ := io.ReadAll(io.LimitReader(r, 4096))
	var top map[string]json.RawMessage
	_ = json.Unmarshal(b, &top)
	str := func(m map[string]json.RawMessage, key string) string {
		var s string
		if v, ok := m[key]; ok && json.Unmarshal(v, &s) == nil {
			return s
		}
		return ""
	}
	var inner map[string]json.RawMessage
	if v, ok := top["error"]; ok {
		_ = json.Unmarshal(v, &inner)
	}
	reason = firstNonEmptyString(str(inner, "message"), str(top, "message"), str(top, "Message"), str(top, "error"), string(b))
	code = firstNonEmptyString(str(inner, "code"), str(inner, "type"), str(inner, "status"), str(top, "code"), str(top, "type"), str(top, "__type"), str(top, "status"))
	reason = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, reason)
	reason = strings.Join(strings.Fields(reason), " ")
	if len(reason) > 240 {
		reason = reason[:240] + "..."
	}
	return reason, code, strings.ToLower(string(b))
}

// upstreamReason is upstreamDetail's reason alone, for the log.
func upstreamReason(r io.Reader) string {
	reason, _, _ := upstreamDetail(r)
	return reason
}

func containsAny(s string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

// classifyRefusal names the cause of a provider's refusal from its status,
// its error code and its body, or returns nil when none of the known causes
// fits (the status then decides: a rejected key, an unknown model).
func classifyRefusal(status int, code, body string) error {
	c := strings.ToLower(code)
	perMinute := containsAny(body, "perminute", "per minute", "per_minute", "per min", "requests per", "tokens per")
	switch {
	// A per-minute limit is a rate limit even where the provider words it as
	// "quota" (Google's free tier says "exceeded your current quota" for both).
	case status == http.StatusTooManyRequests && perMinute && !containsAny(c, "insufficient_quota", "billing"):
		return ErrRateLimited
	case status == http.StatusPaymentRequired,
		containsAny(c, "insufficient_quota", "billing", "insufficient_balance", "insufficient_credit", "credit_balance", "payment_required"),
		containsAny(body, "credit balance", "no credits", "credits remaining", "out of credit", "insufficient balance",
			"insufficient credit", "insufficient funds", "insufficient_quota", "exceeded your current quota", "purchase credits",
			"add credits", "top up", "billing", "payment required", "spending limit", "any credits", "quota has been exhausted",
			"monthly limit", "plan limit"):
		return ErrQuotaExhausted
	case containsAny(c, "content_policy", "content_filter", "moderation", "safety", "responsibleaipolicyviolation"),
		containsAny(body, "content policy", "content management policy", "safety system", "safety filter", "responsible ai", "content_policy_violation"):
		return ErrContentRefused
	case status == http.StatusTooManyRequests, containsAny(c, "rate_limit", "throttling", "toomanyrequests", "resource_exhausted"):
		return ErrRateLimited
	case status == http.StatusRequestEntityTooLarge,
		(status == http.StatusBadRequest || status == http.StatusUnprocessableEntity) &&
			(containsAny(c, "context_length", "too_long", "above_max_length") ||
				containsAny(body, "context length", "context window", "prompt is too long", "too many tokens", "maximum context", "input is too long", "too large for")):
		return ErrRequestTooLarge
	case status == 529, status >= 500, containsAny(c, "overloaded", "serviceunavailable"):
		return ErrProviderBusy
	}
	return nil
}
