package manager

import (
	"errors"
	"fmt"
	"strings"
)

var ErrConnectionOutsideScope = errors.New("connection outside configured runtime scope")

// RuntimeAdmission describes local enforcement, not external policy intent.
type RuntimeAdmission struct {
	ConnectionPermitsVersion int  `json:"connection_permits_version"`
	Version                  int  `json:"version"`
	Enforced                 bool `json:"enforced"`
	ScopeRestricted          bool `json:"scope_restricted"`
	FleetLimit               int  `json:"fleet_limit"`
	MaxWorkers               int  `json:"max_workers"`
}

func (m *Manager) RuntimeAdmission() RuntimeAdmission {
	return RuntimeAdmission{Version: 1, ConnectionPermitsVersion: 1, Enforced: m.config.NewConnectionAdmission,
		ScopeRestricted: m.config.ConnectionScope != nil, FleetLimit: m.config.FleetMaxConnections,
		MaxWorkers: m.config.MaxWorkers}
}

// ParseConnectionScope accepts comma-separated companyID/connectionID pairs.
// nil means unrestricted; an explicitly configured empty scope denies all.
// Scope is local runtime authority, independent of commercial admission.
func ParseConnectionScope(value string, configured bool) (map[string]bool, error) {
	if !configured {
		return nil, nil
	}
	scope := make(map[string]bool)
	if strings.TrimSpace(value) == "" {
		return scope, nil
	}
	for _, entry := range strings.Split(value, ",") {
		pair := strings.Split(strings.TrimSpace(entry), "/")
		if len(pair) != 2 || !scopeUUID(pair[0]) || !scopeUUID(pair[1]) {
			return nil, fmt.Errorf("connection scope requires company UUID/connection UUID pairs")
		}
		scope[strings.ToLower(strings.Join(pair, "/"))] = true
	}
	return scope, nil
}

func scopeUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

func (m *Manager) connectionInScope(companyID, connectionID string) bool {
	return m.config.ConnectionScope == nil || m.config.ConnectionScope[strings.ToLower(companyID+"/"+connectionID)]
}

// Negative advertised capacity excludes scoped runtimes even from older
// placement queries (zero means unlimited). Local capacity is unchanged.
func (m *Manager) advertisedCapacity() int {
	if m.config.ConnectionScope != nil {
		return -1
	}
	return m.config.MaxWorkers
}
