package main

import (
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	ipAttemptLimit     = 20
	ipAttemptWindow    = time.Minute
	loginFailureLimit  = 10
	accountFailureCap  = 100
	loginFailureWindow = 15 * time.Minute
	limiterMaxEntries  = 10000
)

type limitWindow struct {
	start time.Time
	count int
}

// ponytail: in-memory, single-instance limiter keyed per IPv4 address or IPv6 /64; move to a shared store if the api runs more than one instance.
type authLimiter struct {
	mu       sync.Mutex
	ips      map[string]*limitWindow
	pairs    map[string]*limitWindow // failed logins per email and IP key
	accounts map[string]*limitWindow // failed logins per email across all IP keys
}

func newAuthLimiter() *authLimiter {
	return &authLimiter{ips: map[string]*limitWindow{}, pairs: map[string]*limitWindow{}, accounts: map[string]*limitWindow{}}
}

// current returns key's live window, dropping expired entries; nil when none is live.
func current(windows map[string]*limitWindow, key string, length time.Duration, now time.Time) *limitWindow {
	entry := windows[key]
	if entry != nil && !now.Before(entry.start.Add(length)) {
		delete(windows, key)
		return nil
	}
	return entry
}

// admit starts a window for key, sweeping expired entries when the map is full. It fails closed when every entry is live.
func admit(windows map[string]*limitWindow, key string, length time.Duration, now time.Time) *limitWindow {
	if len(windows) >= limiterMaxEntries {
		for other, entry := range windows {
			if !now.Before(entry.start.Add(length)) {
				delete(windows, other)
			}
		}
		if len(windows) >= limiterMaxEntries {
			return nil
		}
	}
	entry := &limitWindow{start: now}
	windows[key] = entry
	return entry
}

func writeTooManyAttempts(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := int((retryAfter + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	writeError(w, http.StatusTooManyRequests, "too many attempts")
}

func ipKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.To4() == nil {
		host = ip.Mask(net.CIDRMask(64, 128)).String()
	}
	return host
}

// allowIP counts one auth request for the client's RemoteAddr host; X-Forwarded-For is not trusted.
// IPv6 clients are keyed by their /64 so rotating addresses within it cannot fill the map.
func (l *authLimiter) allowIP(w http.ResponseWriter, r *http.Request) bool {
	host := ipKey(r)
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry := current(l.ips, host, ipAttemptWindow, now)
	if entry == nil {
		entry = admit(l.ips, host, ipAttemptWindow, now)
		if entry == nil {
			writeTooManyAttempts(w, ipAttemptWindow)
			return false
		}
	}
	if entry.count >= ipAttemptLimit {
		writeTooManyAttempts(w, entry.start.Add(ipAttemptWindow).Sub(now))
		return false
	}
	entry.count++
	return true
}

func pairKey(r *http.Request, email string) string {
	return email + "\x00" + ipKey(r)
}

// live returns key's live window, starting one when none is live; nil when the map is full of live entries.
func live(windows map[string]*limitWindow, key string, now time.Time) *limitWindow {
	if entry := current(windows, key, loginFailureWindow, now); entry != nil {
		return entry
	}
	return admit(windows, key, loginFailureWindow, now)
}

// loginReservation holds the windows allowAccount counted one failed-login slot in, nil for a count it skipped.
type loginReservation struct {
	pair    *limitWindow
	account *limitWindow
}

// allowAccount reserves one failed-login slot for email from this IP key and for email overall, before the password
// check and under one lock, so parallel wrong guesses cannot all pass. It refuses when either count is at its limit.
// A full map fails open for that count (the per-IP limiter still bounds each client), so filling the pair map cannot
// refuse every login. It returns the windows it counted in, for clearFailures or release.
func (l *authLimiter) allowAccount(w http.ResponseWriter, r *http.Request, email string) (loginReservation, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	pair := live(l.pairs, pairKey(r, email), now)
	account := live(l.accounts, email, now)
	if pair != nil && pair.count >= loginFailureLimit {
		writeTooManyAttempts(w, pair.start.Add(loginFailureWindow).Sub(now))
		return loginReservation{}, false
	}
	if account != nil && account.count >= accountFailureCap {
		writeTooManyAttempts(w, account.start.Add(loginFailureWindow).Sub(now))
		return loginReservation{}, false
	}
	if pair != nil {
		pair.count++
	}
	if account != nil {
		account.count++
	}
	return loginReservation{pair: pair, account: account}, true
}

// returnSlot gives back one reserved slot, only while reserved is still key's live window, so a stale reservation
// never lowers a newer window.
func returnSlot(windows map[string]*limitWindow, key string, reserved *limitWindow) {
	if reserved != nil && windows[key] == reserved && reserved.count > 0 {
		reserved.count--
	}
}

// clearFailures runs after a successful login: it clears this IP key's failures for email and returns only the one
// slot this login reserved to the account count, so failures from other IP keys still count toward the cap.
func (l *authLimiter) clearFailures(r *http.Request, email string, reserved loginReservation) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.pairs, pairKey(r, email))
	returnSlot(l.accounts, email, reserved.account)
}

// release returns both reserved slots when the login failed for a server error, which is not a failed guess.
func (l *authLimiter) release(r *http.Request, email string, reserved loginReservation) {
	l.mu.Lock()
	defer l.mu.Unlock()
	returnSlot(l.pairs, pairKey(r, email), reserved.pair)
	returnSlot(l.accounts, email, reserved.account)
}
