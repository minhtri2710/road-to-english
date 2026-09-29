package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

func doAuthFrom(handler http.Handler, path, body, remoteAddr string, header http.Header) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	for key, values := range header {
		req.Header[key] = values
	}
	req.RemoteAddr = remoteAddr
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func assertTooManyAttempts(t *testing.T, response *httptest.ResponseRecorder, maxRetryAfter int) {
	t.Helper()
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body = %s", response.Code, response.Body.String())
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"too many attempts"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
	retryAfter, err := strconv.Atoi(response.Header().Get("Retry-After"))
	if err != nil || retryAfter < 1 || retryAfter > maxRetryAfter {
		t.Fatalf("Retry-After = %q, want 1..%d", response.Header().Get("Retry-After"), maxRetryAfter)
	}
}

func TestAuthLimiterPerIP(t *testing.T) {
	clock := newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	api := newTestAPIWithClock(t, clock)
	for i := 0; i < ipAttemptLimit; i++ {
		path := "/login"
		if i%2 == 0 {
			path = "/signup"
		}
		if response := doAuthFrom(api.handler, path, `{}`, "198.51.100.7:"+strconv.Itoa(1000+i), nil); response.Code != http.StatusBadRequest {
			t.Fatalf("request %d status = %d, want 400", i, response.Code)
		}
	}
	spoofed := http.Header{"X-Forwarded-For": {"203.0.113.9"}}
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{}`, "198.51.100.7:2000", spoofed), 60)

	blockedSignup := doAuthFrom(api.handler, "/signup", `{"email":"blocked@example.com","password":"correct password"}`, "198.51.100.7:2001", nil)
	assertTooManyAttempts(t, blockedSignup, 60)
	var users int
	if err := api.pool.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if users != 0 {
		t.Fatalf("users = %d, want 0: a limited signup must not hash or insert", users)
	}

	if response := doAuthFrom(api.handler, "/login", `{}`, "198.51.100.8:1000", nil); response.Code != http.StatusBadRequest {
		t.Fatalf("other IP status = %d, want 400", response.Code)
	}

	clock.Advance(ipAttemptWindow - time.Nanosecond)
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{}`, "198.51.100.7:3000", nil), 1)
	clock.Advance(time.Nanosecond)
	if response := doAuthFrom(api.handler, "/login", `{}`, "198.51.100.7:3001", nil); response.Code != http.StatusBadRequest {
		t.Fatalf("request at window end status = %d, want 400", response.Code)
	}
}

func TestAuthLimiterKeysIPv6By64(t *testing.T) {
	api := newTestAPI(t)
	allow := func(remoteAddr string) int {
		return doAuthFrom(api.handler, "/login", `{}`, remoteAddr, nil).Code
	}
	for i := 0; i < ipAttemptLimit; i++ {
		if code := allow("[2001:db8:1:2::" + strconv.FormatInt(int64(i+1), 16) + "]:1000"); code != http.StatusBadRequest {
			t.Fatalf("IPv6 request %d status = %d, want 400", i, code)
		}
	}
	if code := allow("[2001:db8:1:2:ffff:ffff:ffff:ffff]:1000"); code != http.StatusTooManyRequests {
		t.Fatalf("another address in the same /64 status = %d, want 429", code)
	}
	if code := allow("[2001:db8:1:3::1]:1000"); code != http.StatusBadRequest {
		t.Fatalf("an address in a different /64 status = %d, want 400", code)
	}
	for i := 0; i < ipAttemptLimit; i++ {
		if code := allow("198.51.100.7:" + strconv.Itoa(1000+i)); code != http.StatusBadRequest {
			t.Fatalf("IPv4 request %d status = %d, want 400", i, code)
		}
	}
	if code := allow("198.51.100.7:1100"); code != http.StatusTooManyRequests {
		t.Fatalf("IPv4 address status = %d, want 429", code)
	}
	if code := allow("198.51.100.8:1000"); code != http.StatusBadRequest {
		t.Fatalf("a different IPv4 address status = %d, want 400", code)
	}
}

func TestAuthLimiterPerAccountChecksBeforePassword(t *testing.T) {
	clock := newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	api := newTestAPIWithClock(t, clock)
	signupForSync(t, api, "locked@example.com")
	for i := 0; i < loginFailureLimit; i++ {
		if response := doJSON(api.handler, http.MethodPost, "/login", `{"email":" LOCKED@example.com ","password":"wrong password"}`); response.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d status = %d, want 401", i, response.Code)
		}
	}
	// The correct password would succeed, so a 429 proves the limit runs before password verification.
	assertTooManyAttempts(t, doJSON(api.handler, http.MethodPost, "/login", `{"email":"locked@example.com","password":"correct password"}`), 900)
	clock.Advance(loginFailureWindow - time.Nanosecond)
	assertTooManyAttempts(t, doJSON(api.handler, http.MethodPost, "/login", `{"email":"locked@example.com","password":"correct password"}`), 1)
	clock.Advance(time.Nanosecond)
	if response := doJSON(api.handler, http.MethodPost, "/login", `{"email":"locked@example.com","password":"correct password"}`); response.Code != http.StatusOK {
		t.Fatalf("login at account window end status = %d, want 200", response.Code)
	}

	signupForSync(t, api, "other@example.com")
	if response := doJSON(api.handler, http.MethodPost, "/login", `{"email":"other@example.com","password":"correct password"}`); response.Code != http.StatusOK {
		t.Fatalf("other account status = %d, want 200", response.Code)
	}
}

func TestSuccessfulLoginClearsAccountFailures(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "clears@example.com")
	login := func(i int, password string) int {
		return doAuthFrom(api.handler, "/login", `{"email":"clears@example.com","password":"`+password+`"}`, "198.51.100.10:"+strconv.Itoa(1000+i), nil).Code
	}
	for i := 0; i < loginFailureLimit-1; i++ {
		if code := login(i, "wrong password"); code != http.StatusUnauthorized {
			t.Fatalf("failure %d status = %d, want 401", i, code)
		}
	}
	if code := login(20, "correct password"); code != http.StatusOK {
		t.Fatalf("login status = %d, want 200", code)
	}
	for i := 0; i < loginFailureLimit-1; i++ {
		if code := login(30+i, "wrong password"); code != http.StatusUnauthorized {
			t.Fatalf("failure after success %d status = %d, want 401", i, code)
		}
	}
	if code := login(50, "correct password"); code != http.StatusOK {
		t.Fatalf("login after cleared failures status = %d, want 200", code)
	}
}

func TestAuthLimiterPerAccountHoldsUnderConcurrentFailures(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "burst@example.com")
	const attempts = ipAttemptLimit - 1
	codes := make([]int, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"wrong password"}`, "198.51.100.7:"+strconv.Itoa(1000+i), nil).Code
		}(i)
	}
	wg.Wait()
	unauthorized, limited := 0, 0
	for i, code := range codes {
		switch code {
		case http.StatusUnauthorized:
			unauthorized++
		case http.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("attempt %d status = %d, want 401 or 429", i, code)
		}
	}
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"correct password"}`, "198.51.100.7:2000", nil), 900)
	if unauthorized != loginFailureLimit || limited != attempts-loginFailureLimit {
		t.Fatalf("401s = %d, 429s = %d; want %d and %d", unauthorized, limited, loginFailureLimit, attempts-loginFailureLimit)
	}
	if code := doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"wrong password"}`, "198.51.100.8:1000", nil).Code; code != http.StatusUnauthorized {
		t.Fatalf("other IP key wrong password status = %d, want 401", code)
	}
	if code := doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"correct password"}`, "198.51.100.9:1000", nil).Code; code != http.StatusOK {
		t.Fatalf("fresh IP key correct password status = %d, want 200", code)
	}
}

func TestAuthLimiterPerAccountCapAcrossIPKeys(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "cap@example.com")
	wrong := `{"email":"cap@example.com","password":"wrong password"}`
	ips := accountFailureCap / loginFailureLimit
	for ip := 0; ip < ips; ip++ {
		for i := 0; i < loginFailureLimit; i++ {
			if code := doAuthFrom(api.handler, "/login", wrong, "198.51.100."+strconv.Itoa(10+ip)+":"+strconv.Itoa(1000+i), nil).Code; code != http.StatusUnauthorized {
				t.Fatalf("IP %d failure %d status = %d, want 401", ip, i, code)
			}
		}
	}
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", wrong, "203.0.113.1:1000", nil), 900)
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{"email":"cap@example.com","password":"correct password"}`, "203.0.113.2:1000", nil), 900)
	if code := doAuthFrom(api.handler, "/login", `{"email":"other-cap@example.com","password":"wrong password"}`, "203.0.113.3:1000", nil).Code; code != http.StatusUnauthorized {
		t.Fatalf("other account status = %d, want 401", code)
	}
}

func TestAuthLimiterSuccessReturnsOnlyItsAccountSlot(t *testing.T) {
	api := newTestAPIWithClock(t, newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)))
	signupForSync(t, api, "a@example.com")
	login := func(remoteAddr, password string) int {
		return doAuthFrom(api.handler, "/login", `{"email":"a@example.com","password":"`+password+`"}`, remoteAddr, nil).Code
	}
	for i := 0; i < accountFailureCap-1; i++ {
		ip := 10 + i/loginFailureLimit
		if code := login("198.51.100."+strconv.Itoa(ip)+":"+strconv.Itoa(1000+i), "wrong password"); code != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401", i, code)
		}
	}
	owner := "203.0.113.1:1000"
	if code := login(owner, "correct password"); code != http.StatusOK {
		t.Fatalf("owner login status = %d, want 200", code)
	}
	if code := login("203.0.113.2:1000", "wrong password"); code != http.StatusUnauthorized {
		t.Fatalf("attempt after successful login status = %d, want 401", code)
	}
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{"email":"a@example.com","password":"correct password"}`, "203.0.113.3:1000", nil), 900)
}

func TestAuthLimiterMapCapacityPolicies(t *testing.T) {
	clock := newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	fill := func(windows map[string]*limitWindow, start time.Time) {
		for i := 0; i < limiterMaxEntries; i++ {
			windows["filler-"+strconv.Itoa(i)] = &limitWindow{start: start, count: 1}
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = "203.0.113.1:1000"

	t.Run("live IP entries fail closed", func(t *testing.T) {
		limiter := newAuthLimiter(clock.Now)
		fill(limiter.ips, clock.Now())
		recorder := httptest.NewRecorder()
		if limiter.allowIP(recorder, request) {
			t.Fatal("allowIP() admitted a new IP with a full live map")
		}
		assertTooManyAttempts(t, recorder, 60)
	})

	t.Run("live pair entries fail open", func(t *testing.T) {
		limiter := newAuthLimiter(clock.Now)
		fill(limiter.pairs, clock.Now())
		reserved, ok := limiter.allowAccount(httptest.NewRecorder(), request, "fresh@example.com")
		if !ok || reserved.pair != nil || reserved.account == nil || reserved.account.count != 1 {
			t.Fatalf("reservation = %#v, allowed = %v; want pair skipped and account counted", reserved, ok)
		}
		limiter.clearFailures(request, "fresh@example.com", reserved)
		if reserved.account.count != 0 {
			t.Fatalf("account count after success = %d, want 0", reserved.account.count)
		}
	})

	t.Run("live account entries fail open", func(t *testing.T) {
		limiter := newAuthLimiter(clock.Now)
		fill(limiter.accounts, clock.Now())
		other := limiter.accounts["filler-0"]
		reserved, ok := limiter.allowAccount(httptest.NewRecorder(), request, "second@example.com")
		if !ok || reserved.account != nil {
			t.Fatalf("full account map: allowed = %v, reservation = %#v; want allowed with no account reservation", ok, reserved)
		}
		limiter.clearFailures(request, "second@example.com", reserved)
		if other.count != 1 {
			t.Fatalf("an unrecorded reservation changed another account: count %d", other.count)
		}
	})

	t.Run("expired IP entries are swept and admit", func(t *testing.T) {
		limiter := newAuthLimiter(clock.Now)
		fill(limiter.ips, clock.Now().Add(-ipAttemptWindow))
		if !limiter.allowIP(httptest.NewRecorder(), request) {
			t.Fatal("allowIP() refused after all full-map entries expired")
		}
		if _, exists := limiter.ips["filler-0"]; exists {
			t.Fatal("expired filler entry remains after admit sweep")
		}
		if limiter.ips[ipKey(request)] == nil {
			t.Fatal("new IP entry was not admitted after the sweep")
		}
	})
}

func TestAuthLimiterSuccessDoesNotReturnASlotFromAnExpiredWindow(t *testing.T) {
	clock := newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	limiter := newAuthLimiter(clock.Now)
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = "203.0.113.1:1000"
	stale, ok := limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com")
	if !ok {
		t.Fatal("first attempt refused")
	}
	clock.Advance(loginFailureWindow)
	other := httptest.NewRequest(http.MethodPost, "/login", nil)
	other.RemoteAddr = "203.0.113.2:1000"
	fresh, ok := limiter.allowAccount(httptest.NewRecorder(), other, "a@example.com")
	if !ok || fresh.account == stale.account {
		t.Fatal("second attempt did not start a new account window")
	}
	limiter.clearFailures(req, "a@example.com", stale)
	if stale.account.count != 1 {
		t.Fatalf("stale window count = %d, want 1: a stale reservation was returned", stale.account.count)
	}
	if fresh.account.count != 1 {
		t.Fatalf("new window count = %d, want 1: a stale reservation was returned to it", fresh.account.count)
	}
}

func TestLoginServerErrorReleasesItsReservation(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "outage@example.com")
	login := func(ctx context.Context, i int, password string) int {
		req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewBufferString(`{"email":"outage@example.com","password":"`+password+`"}`)).WithContext(ctx)
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "198.51.100.20:" + strconv.Itoa(1000+i)
		recorder := httptest.NewRecorder()
		api.handler.ServeHTTP(recorder, req)
		return recorder.Code
	}
	// A cancelled context makes GetUserByEmail fail with an error that is not ErrUserNotFound.
	down, cancel := context.WithCancel(context.Background())
	cancel()
	for i := 0; i < loginFailureLimit+5; i++ {
		if code := login(down, i, "wrong password"); code != http.StatusInternalServerError {
			t.Fatalf("outage attempt %d status = %d, want 500", i, code)
		}
	}
	if code := login(context.Background(), 100, "wrong password"); code != http.StatusUnauthorized {
		t.Fatalf("wrong password after outage status = %d, want 401: server errors counted as failed logins", code)
	}
}

func TestAuthLimiterReleaseReturnsBothSlots(t *testing.T) {
	clock := newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	limiter := newAuthLimiter(clock.Now)
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = "203.0.113.1:1000"
	pairs := func() int { return limiter.pairs[pairKey(req, "a@example.com")].count }
	accounts := func() int { return limiter.accounts["a@example.com"].count }
	if _, ok := limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com"); !ok {
		t.Fatal("first attempt refused")
	}
	reserved, ok := limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com")
	if !ok {
		t.Fatal("second attempt refused")
	}
	limiter.release(req, "a@example.com", reserved)
	if pairs() != 1 || accounts() != 1 {
		t.Fatalf("after release pair = %d, account = %d; want 1 and 1", pairs(), accounts())
	}

	stale, ok := limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com")
	if !ok {
		t.Fatal("third attempt refused")
	}
	clock.Advance(loginFailureWindow)
	fresh, ok := limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com")
	if !ok || fresh.pair == stale.pair || fresh.account == stale.account {
		t.Fatal("attempt after expiry did not start new windows")
	}
	limiter.release(req, "a@example.com", stale)
	if fresh.pair.count != 1 || fresh.account.count != 1 {
		t.Fatalf("new windows pair = %d, account = %d; want 1 and 1: a stale release lowered them", fresh.pair.count, fresh.account.count)
	}
}
