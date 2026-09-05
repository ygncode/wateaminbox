package manager

import "fmt"

// Inputs are SQL identifiers/placeholders supplied by this package, never user
// data. Tenant and connection identity must both match an unexpired permit.
// The outer grant lease still bounds every permit; recovery is handled elsewhere.
func connectionAdmissionSQL(alias, company, connection string) string {
	return fmt.Sprintf(`(%[1]s.expires_at>clock_timestamp() AND
		(%[1]s.accepting_new OR EXISTS (
		 SELECT 1 FROM jsonb_array_elements(%[1]s.connection_permits) p
		 WHERE p->>'company_id'=%[2]s AND p->>'connection_id'=%[3]s
		 AND (p->>'expires_at')::timestamptz>clock_timestamp())))`, alias, company, connection)
}

func admissionIdentity(identity []string) (string, string) {
	if len(identity) != 2 {
		return "", ""
	}
	return identity[0], identity[1]
}
