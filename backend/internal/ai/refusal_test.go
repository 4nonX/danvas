package ai

import (
	"errors"
	"strings"
	"testing"
)

// Provider refusals as the providers send them: the cause has to come out
// right whatever status they use for it.
func TestClassifyRefusal(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"openai no credits", 429, `{"error":{"message":"You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}`, ErrQuotaExhausted},
		{"openai quota", 429, `{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}`, ErrQuotaExhausted},
		{"openai rate limit", 429, `{"error":{"message":"Rate limit reached for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Used 29000, Requested 2000.","type":"tokens","code":"rate_limit_exceeded"}}`, ErrRateLimited},
		{"anthropic credit", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`, ErrQuotaExhausted},
		{"anthropic rate limit", 429, `{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization."}}`, ErrRateLimited},
		{"anthropic overloaded", 529, `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, ErrProviderBusy},
		{"google per minute", 429, `{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}`, ErrRateLimited},
		{"google per day", 429, `{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}`, ErrQuotaExhausted},
		{"deepseek balance", 402, `{"error":{"message":"Insufficient Balance","type":"unknown_error"}}`, ErrQuotaExhausted},
		{"openrouter credits", 402, `{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/credits","code":402}}`, ErrQuotaExhausted},
		{"xai no credits", 403, `{"code":"The caller does not have permission to execute the specified operation","error":"Your newly created team doesn't have any credits yet."}`, ErrQuotaExhausted},
		{"openai image policy", 400, `{"error":{"message":"Your request was rejected as a result of our safety system.","type":"image_generation_user_error","code":"content_policy_violation"}}`, ErrContentRefused},
		{"azure content filter", 400, `{"error":{"message":"The response was filtered due to the prompt triggering Azure OpenAI's content management policy.","code":"content_filter"}}`, ErrContentRefused},
		{"openai context", 400, `{"error":{"message":"This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.","type":"invalid_request_error","code":"context_length_exceeded"}}`, ErrRequestTooLarge},
		{"anthropic too long", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}}`, ErrRequestTooLarge},
		{"bedrock throttling", 429, `{"message":"Too many requests, please wait before trying again."}`, ErrRateLimited},
		{"server error", 500, `{"error":{"message":"The server had an error while processing your request."}}`, ErrProviderBusy},
		{"service unavailable", 503, `upstream connect error`, ErrProviderBusy},
		{"anthropic key without workspace", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace."}}`, ErrKeyUnscoped},
		{"openai unverified organization", 403, `{"error":{"message":"Your organization must be verified to use the model ` + "`gpt-image-1`" + `. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization.","type":"invalid_request_error","code":null}}`, ErrVerificationRequired},
		{"rejected key", 401, `{"error":{"message":"Incorrect API key provided: sk-xxx.","type":"invalid_request_error","code":"invalid_api_key"}}`, nil},
		{"iam", 403, `{"message":"User: arn:aws:iam::1:user/x is not authorized to perform: bedrock:InvokeModel on resource"}`, nil},
		{"unknown model", 404, `{"error":{"message":"The model gpt-9 does not exist","code":"model_not_found"}}`, nil},
		{"unsupported parameter", 400, `{"error":{"message":"Unsupported parameter: 'temperature' is not supported with this model.","code":"unsupported_parameter"}}`, nil},
	}
	for _, c := range cases {
		_, code, raw := upstreamDetail(strings.NewReader(c.body))
		if got := classifyRefusal(c.status, code, raw); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// The cause rides with ErrBadGateway and the status, and an empty account is
// never retried as a negotiable parameter.
func TestBadGatewayNamesTheCause(t *testing.T) {
	_, code, raw := upstreamDetail(strings.NewReader(`{"error":{"message":"You have no credits remaining.","code":"insufficient_quota"}}`))
	se := &httpStatusError{status: 429, code: code, body: raw}
	err := badGateway(CallConfig{Provider: ProviderOpenAI}, se)
	var up *UpstreamError
	if !errors.Is(err, ErrBadGateway) || !errors.Is(err, ErrQuotaExhausted) || errors.Is(err, ErrRateLimited) || !errors.As(err, &up) || up.Status != 429 {
		t.Fatalf("no credit: %v", err)
	}
	_, code, raw = upstreamDetail(strings.NewReader(`{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`))
	if isNegotiable4xx(&httpStatusError{status: 400, code: code, body: raw}) {
		t.Fatal("an empty account must not be retried without a parameter")
	}
	if !isNegotiable4xx(&httpStatusError{status: 400, body: "unsupported parameter"}) {
		t.Fatal("an unsupported parameter stays negotiable")
	}
	if err := badGateway(CallConfig{Provider: ProviderOpenAI}, errProviderTimeout); !errors.Is(err, ErrProviderTimeout) || errors.Is(err, ErrProviderUnreachable) {
		t.Fatalf("timeout: %v", err)
	}
	if err := badGateway(CallConfig{Provider: ProviderOpenAI}, errProviderTransport); !errors.Is(err, ErrProviderUnreachable) {
		t.Fatalf("unreachable: %v", err)
	}
}

func TestUpstreamDetailReadsCodes(t *testing.T) {
	reason, code, _ := upstreamDetail(strings.NewReader(`{"error":{"message":"Insufficient Balance","code":"insufficient_quota"}}`))
	if reason != "Insufficient Balance" || code != "insufficient_quota" {
		t.Fatalf("got %q %q", reason, code)
	}
	if _, code, _ := upstreamDetail(strings.NewReader(`{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"x"}}`)); code != "RESOURCE_EXHAUSTED" {
		t.Fatalf("a numeric code must give way to the status name, got %q", code)
	}
	if reason, _, _ := upstreamDetail(strings.NewReader(`{"error":"Your team has no credits"}`)); reason != "Your team has no credits" {
		t.Fatalf("a plain error string is the reason, got %q", reason)
	}
}
