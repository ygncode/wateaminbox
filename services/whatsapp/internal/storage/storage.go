package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

// Config holds storage configuration.
type Config struct {
	Endpoint        string // S3 endpoint (e.g., "http://localhost:9000" for MinIO)
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	Region          string
	UsePathStyle    bool // Use path-style addressing (required for MinIO)
}

// Client provides media storage operations.
type Client struct {
	s3Client *s3.Client
	bucket   string
}

// New creates a new storage client.
func New(cfg Config) (*Client, error) {
	if cfg.Region == "" {
		cfg.Region = "us-east-1" // Default region
	}

	// Create custom resolver for S3-compatible endpoints
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
		if cfg.Endpoint != "" {
			return aws.Endpoint{
				URL:               cfg.Endpoint,
				HostnameImmutable: true,
			}, nil
		}
		return aws.Endpoint{}, &aws.EndpointNotFoundError{}
	})

	// Load AWS config
	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID,
			cfg.SecretAccessKey,
			"",
		)),
		config.WithEndpointResolverWithOptions(customResolver),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create S3 client
	s3Client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.UsePathStyle
	})

	return &Client{
		s3Client: s3Client,
		bucket:   cfg.Bucket,
	}, nil
}

// UploadMedia uploads media data and returns a stable private object reference.
func (c *Client) UploadMedia(ctx context.Context, data []byte, mimeType string, companyID string) (string, error) {
	if !validTenantID(companyID) {
		return "", fmt.Errorf("invalid company ID for media key")
	}
	ext := getExtensionFromMimeType(mimeType)
	key := generateMediaKey(companyID, ext)
	checksum := sha256.Sum256(data)

	_, err := c.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(c.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(mimeType),
		ContentLength: aws.Int64(int64(len(data))),
		Metadata: map[string]string{
			"sha256":    hex.EncodeToString(checksum[:]),
			"tenant_id": companyID,
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload media: %w", err)
	}

	return c.getPrivateReference(key), nil
}

// UploadMediaWithFilename uploads media with a sanitized filename.
func (c *Client) UploadMediaWithFilename(ctx context.Context, data []byte, mimeType string, companyID string, filename string) (string, error) {
	if !validTenantID(companyID) {
		return "", fmt.Errorf("invalid company ID for media key")
	}
	safeFilename := sanitizeFilename(filename)
	key := generateMediaKeyWithFilename(companyID, safeFilename)
	checksum := sha256.Sum256(data)

	_, err := c.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:             aws.String(c.bucket),
		Key:                aws.String(key),
		Body:               bytes.NewReader(data),
		ContentType:        aws.String(mimeType),
		ContentLength:      aws.Int64(int64(len(data))),
		ContentDisposition: aws.String(fmt.Sprintf("inline; filename=\"%s\"", safeFilename)),
		Metadata: map[string]string{
			"sha256":            hex.EncodeToString(checksum[:]),
			"tenant_id":         companyID,
			"original_filename": safeFilename,
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload media: %w", err)
	}

	return c.getPrivateReference(key), nil
}

// DownloadMediaObject streams an object with a strict size cap and optional checksum verification.
func (c *Client) DownloadMediaObject(ctx context.Context, key string, maxBytes int64, expectedChecksum string) ([]byte, error) {
	object, err := c.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get media object: %w", err)
	}
	defer object.Body.Close()

	if object.ContentLength != nil && (*object.ContentLength <= 0 || *object.ContentLength > maxBytes) {
		return nil, fmt.Errorf("media object size %d exceeds limit %d", *object.ContentLength, maxBytes)
	}
	data, err := io.ReadAll(io.LimitReader(object.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read media object: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("media object exceeds limit %d", maxBytes)
	}
	if expectedChecksum != "" {
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != expectedChecksum {
			return nil, fmt.Errorf("media object checksum mismatch")
		}
	}
	return data, nil
}

// DeleteMedia deletes a media file by its key.
func (c *Client) DeleteMedia(ctx context.Context, key string) error {
	_, err := c.s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete media: %w", err)
	}
	return nil
}

// GetPresignedURL generates a presigned URL for temporary access.
func (c *Client) GetPresignedURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	presignClient := s3.NewPresignClient(c.s3Client)

	presignedReq, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}

	return presignedReq.URL, nil
}

// getPrivateReference returns an internal identifier, never a download URL.
func (c *Client) getPrivateReference(key string) string {
	return (&url.URL{Scheme: "s3", Host: c.bucket, Path: "/" + key}).String()
}

var tenantIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func validTenantID(companyID string) bool {
	return companyID != "" && tenantIDPattern.MatchString(companyID)
}

func sanitizeFilename(filename string) string {
	filename = strings.Map(func(r rune) rune {
		if r > 127 || strings.ContainsRune(`/\\\x00\r\n`, r) {
			return '_'
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || strings.ContainsRune("._-", r) {
			return r
		}
		return '_'
	}, filename)
	filename = strings.ReplaceAll(filename, "..", "__")
	filename = strings.Trim(filename, ".")
	if filename == "" {
		return "file"
	}
	return filename
}

// generateMediaKey creates a unique key for storing media.
func generateMediaKey(companyID string, ext string) string {
	timestamp := time.Now().Format("2006/01/02")
	uniqueID := uuid.New().String()
	return fmt.Sprintf("media/%s/%s/%s%s", companyID, timestamp, uniqueID, ext)
}

// generateMediaKeyWithFilename creates a unique key preserving original filename.
func generateMediaKeyWithFilename(companyID string, filename string) string {
	timestamp := time.Now().Format("2006/01/02")
	uniqueID := uuid.New().String()[:8]
	return fmt.Sprintf("media/%s/%s/%s-%s", companyID, timestamp, uniqueID, filename)
}

// getExtensionFromMimeType returns the file extension for a MIME type.
func getExtensionFromMimeType(mimeType string) string {
	mimeToExt := map[string]string{
		// Images
		"image/jpeg":    ".jpg",
		"image/png":     ".png",
		"image/gif":     ".gif",
		"image/webp":    ".webp",
		"image/svg+xml": ".svg",

		// Video
		"video/mp4":       ".mp4",
		"video/webm":      ".webm",
		"video/quicktime": ".mov",
		"video/x-msvideo": ".avi",
		"video/3gpp":      ".3gp",

		// Audio
		"audio/mpeg":            ".mp3",
		"audio/ogg":             ".ogg",
		"audio/wav":             ".wav",
		"audio/webm":            ".webm",
		"audio/aac":             ".aac",
		"audio/mp4":             ".m4a",
		"audio/x-m4a":           ".m4a",
		"audio/amr":             ".amr",
		"audio/opus":            ".opus",
		"audio/ogg;codecs=opus": ".opus",

		// Documents
		"application/pdf":    ".pdf",
		"application/msword": ".doc",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
		"application/vnd.ms-excel": ".xls",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         ".xlsx",
		"application/vnd.ms-powerpoint":                                             ".ppt",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
		"text/plain":       ".txt",
		"text/csv":         ".csv",
		"application/json": ".json",
		"application/xml":  ".xml",
		"application/zip":  ".zip",
	}

	if ext, ok := mimeToExt[mimeType]; ok {
		return ext
	}
	return ".bin" // Default for unknown types
}

// EnsureBucketExists creates the bucket if it doesn't exist.
func (c *Client) EnsureBucketExists(ctx context.Context) error {
	// Check if bucket exists
	_, err := c.s3Client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(c.bucket),
	})
	if err == nil {
		return nil // Bucket exists
	}

	// Create bucket
	_, err = c.s3Client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(c.bucket),
	})
	if err != nil {
		return fmt.Errorf("failed to create bucket: %w", err)
	}

	return nil
}
