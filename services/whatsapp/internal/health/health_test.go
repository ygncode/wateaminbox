package health

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

type fakeProbe struct {
	connected bool
	loggedIn  bool
}

func (f fakeProbe) IsConnected() bool { return f.connected }
func (f fakeProbe) IsLoggedIn() bool  { return f.loggedIn }

func startHealth(t *testing.T, probe ConnectionProbe) (*Server, string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := New(probe)
	addr, err := h.Serve(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("serve: %v", err)
	}
	return h, "http://" + addr
}

func get(t *testing.T, url string) (int, State) {
	t.Helper()
	resp, err := http.Get(url) //nolint:noctx // test helper against a loopback server
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	var s State
	if resp.Header.Get("Content-Type") == "application/json" {
		if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return resp.StatusCode, s
}

func TestHealthLiveAlwaysOK(t *testing.T) {
	_, base := startHealth(t, fakeProbe{})
	if code, _ := get(t, base+"/healthz/live"); code != http.StatusOK {
		t.Fatalf("live = %d, want 200", code)
	}
}

func TestHealthReadyRequiresReadyConnectedLoggedIn(t *testing.T) {
	probe := &fakeProbe{}
	h, base := startHealth(t, probe)

	if code, s := get(t, base+"/healthz/ready"); code != http.StatusServiceUnavailable || s.Ready {
		t.Fatalf("before markReady: code=%d state=%+v", code, s)
	}

	h.MarkReady()
	if code, s := get(t, base+"/healthz/ready"); code != http.StatusServiceUnavailable || !s.Ready || s.Connected {
		t.Fatalf("ready but disconnected: code=%d state=%+v", code, s)
	}

	probe.connected = true
	if code, s := get(t, base+"/healthz/ready"); code != http.StatusServiceUnavailable || s.LoggedIn {
		t.Fatalf("connected but pairing: code=%d state=%+v", code, s)
	}

	probe.loggedIn = true
	if code, s := get(t, base+"/healthz/ready"); code != http.StatusOK || !(s.Ready && s.Connected && s.LoggedIn) {
		t.Fatalf("fully ready: code=%d state=%+v", code, s)
	}
}

func TestHealthRejectsOtherMethodsAndPaths(t *testing.T) {
	_, base := startHealth(t, fakeProbe{connected: true, loggedIn: true})
	resp, err := http.Post(base+"/healthz/ready", "text/plain", nil) //nolint:noctx
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST ready = %d, want 405", resp.StatusCode)
	}
	if code, _ := get(t, base+"/"); code != http.StatusNotFound {
		t.Fatalf("GET / = %d, want 404", code)
	}
}
