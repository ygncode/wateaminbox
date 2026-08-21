package manager

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	defaultArtifactRoot    = "/var/lib/wateaminbox/worker-artifacts"
	defaultArtifactVersion = "embedded"
)

var (
	artifactVersionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	artifactSHA256Pattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// WorkerArtifact identifies one immutable WhatsApp worker executable. A rollout
// always records both fields: a human-readable version is not a security
// boundary, while the digest prevents a retained path from being replaced in
// place without detection.
type WorkerArtifact struct {
	Version    string `json:"version"`
	SHA256     string `json:"sha256"`
	BinaryPath string `json:"-"`
}

func validateArtifactVersion(version string) error {
	if !artifactVersionPattern.MatchString(version) || version == "." || version == ".." {
		return fmt.Errorf("invalid artifact version %q", version)
	}
	return nil
}

func validateArtifactSHA256(digest string) error {
	if !artifactSHA256Pattern.MatchString(digest) {
		return fmt.Errorf("artifact sha256 must be 64 lowercase hexadecimal characters")
	}
	return nil
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// persistedArtifactPath validates durable identity before constructing the path
// used only to identify and stop an adopted process. Launches still call
// resolveArtifact and hash the bytes before execution.
func (m *Manager) persistedArtifactPath(version, digest string) (string, error) {
	if err := validateArtifactVersion(version); err != nil {
		return "", err
	}
	if err := validateArtifactSHA256(digest); err != nil {
		return "", err
	}
	root, err := filepath.Abs(m.config.ArtifactRoot)
	if err != nil {
		return "", fmt.Errorf("resolve artifact root: %w", err)
	}
	candidate := filepath.Join(root, version, "whatsapp-worker")
	relative, err := filepath.Rel(root, candidate)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("artifact path escapes configured root")
	}
	return candidate, nil
}

// resolveArtifact validates user-controlled version/digest values before path
// construction, rejects symlinks and non-executables, proves the final path is
// inside ArtifactRoot, and hashes the file at the point it is selected.
func (m *Manager) resolveArtifact(version, expectedSHA256 string) (WorkerArtifact, error) {
	rawVersion := version
	version = strings.TrimSpace(version)
	if rawVersion != version {
		return WorkerArtifact{}, fmt.Errorf("invalid artifact version %q", rawVersion)
	}
	expectedSHA256 = strings.ToLower(strings.TrimSpace(expectedSHA256))
	if err := validateArtifactVersion(version); err != nil {
		return WorkerArtifact{}, err
	}
	if err := validateArtifactSHA256(expectedSHA256); err != nil {
		return WorkerArtifact{}, err
	}

	root, err := filepath.Abs(m.config.ArtifactRoot)
	if err != nil {
		return WorkerArtifact{}, fmt.Errorf("resolve artifact root: %w", err)
	}
	if resolvedRoot, resolveErr := filepath.EvalSymlinks(root); resolveErr == nil {
		root = resolvedRoot
	} else {
		return WorkerArtifact{}, fmt.Errorf("resolve artifact root: %w", resolveErr)
	}
	candidate := filepath.Join(root, version, "whatsapp-worker")
	relative, err := filepath.Rel(root, candidate)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return WorkerArtifact{}, fmt.Errorf("artifact path escapes configured root")
	}

	info, err := os.Lstat(candidate)
	if err != nil {
		return WorkerArtifact{}, fmt.Errorf("inspect artifact %q: %w", version, err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return WorkerArtifact{}, fmt.Errorf("artifact %q must not be a symlink", version)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
		return WorkerArtifact{}, fmt.Errorf("artifact %q is not an executable regular file", version)
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return WorkerArtifact{}, fmt.Errorf("resolve artifact %q: %w", version, err)
	}
	resolvedRelative, err := filepath.Rel(root, resolved)
	if err != nil || resolvedRelative == ".." || strings.HasPrefix(resolvedRelative, ".."+string(filepath.Separator)) {
		return WorkerArtifact{}, fmt.Errorf("artifact %q resolves outside configured root", version)
	}
	actual, err := sha256File(resolved)
	if err != nil {
		return WorkerArtifact{}, fmt.Errorf("hash artifact %q: %w", version, err)
	}
	if !strings.EqualFold(actual, expectedSHA256) {
		return WorkerArtifact{}, fmt.Errorf("artifact %q sha256 mismatch", version)
	}
	return WorkerArtifact{Version: version, SHA256: actual, BinaryPath: resolved}, nil
}

func (m *Manager) defaultArtifact(ctx context.Context, companyID string) (WorkerArtifact, error) {
	if m.registry != nil && m.registryReady.Load() && companyID != "" {
		promotedVersion, promotedSHA256, found, err := m.registry.GetCompanyWorkerArtifact(ctx, companyID)
		if err != nil {
			return WorkerArtifact{}, fmt.Errorf("read promoted company worker artifact: %w", err)
		}
		if found {
			return m.resolveArtifact(promotedVersion, promotedSHA256)
		}
	}
	return m.configuredBootstrapArtifact()
}

// configuredBootstrapArtifact deliberately ignores rollout history. Migration
// normalization must bind legacy rows to the installed bootstrap bytes, never
// to a later company promotion.
func (m *Manager) configuredBootstrapArtifact() (WorkerArtifact, error) {
	version := strings.TrimSpace(m.config.DefaultArtifactVersion)
	if version == "" {
		version = defaultArtifactVersion
	}
	if err := validateArtifactVersion(version); err != nil {
		return WorkerArtifact{}, err
	}
	digest := strings.ToLower(strings.TrimSpace(m.config.DefaultArtifactSHA256))
	if digest == "" && version != defaultArtifactVersion && m.config.ArtifactRoot != "" {
		// The immutable installer writes this manifest beside the executable.
		// Reading it keeps existing deployment scripts backward compatible: they
		// need only select a version, not transport a computed digest through
		// Compose environment interpolation.
		manifest, err := os.ReadFile(filepath.Join(m.config.ArtifactRoot, version, "sha256"))
		if err != nil {
			return WorkerArtifact{}, fmt.Errorf("read default artifact manifest: %w", err)
		}
		digest = strings.TrimSpace(string(manifest))
	}
	if digest != "" && m.config.ArtifactRoot != "" {
		return m.resolveArtifact(version, digest)
	}

	// Compatibility path for local development and the first migration-first
	// deployment. Rollouts themselves never use this path: every target must be
	// selected from ArtifactRoot with an explicit digest.
	path := m.config.WhatsAppBinaryPath
	if path == "" {
		return WorkerArtifact{}, errors.New("default worker binary path is empty")
	}
	actual := digest
	if actual == "" {
		if computed, err := sha256File(path); err == nil {
			actual = computed
		}
	}
	return WorkerArtifact{Version: version, SHA256: actual, BinaryPath: path}, nil
}
