package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"path"
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
	PublicURL       string // Public URL prefix for accessing files
	UsePathStyle    bool   // Use path-style addressing (required for MinIO)
}

// Client provides media storage operations.
type Client struct {
	s3Client  *s3.Client
	bucket    string
	publicURL string
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

	// Determine public URL
	publicURL := cfg.PublicURL
	if publicURL == "" {
		publicURL = cfg.Endpoint
	}

	return &Client{
		s3Client:  s3Client,
		bucket:    cfg.Bucket,
		publicURL: publicURL,
	}, nil
}

// UploadMedia uploads media data and returns the public URL.
func (c *Client) UploadMedia(ctx context.Context, data []byte, mimeType string, companyID string) (string, error) {
	// Generate unique file key
	ext := getExtensionFromMimeType(mimeType)
	key := generateMediaKey(companyID, ext)

	// Upload to S3
	_, err := c.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(c.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(mimeType),
		ContentLength: aws.Int64(int64(len(data))),
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload media: %w", err)
	}

	// Generate public URL
	publicURL := c.getPublicURL(key)

	return publicURL, nil
}

// UploadMediaWithFilename uploads media with a specific filename.
func (c *Client) UploadMediaWithFilename(ctx context.Context, data []byte, mimeType string, companyID string, filename string) (string, error) {
	// Generate unique file key preserving the original filename
	key := generateMediaKeyWithFilename(companyID, filename)

	// Upload to S3
	_, err := c.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:             aws.String(c.bucket),
		Key:                aws.String(key),
		Body:               bytes.NewReader(data),
		ContentType:        aws.String(mimeType),
		ContentLength:      aws.Int64(int64(len(data))),
		ContentDisposition: aws.String(fmt.Sprintf("inline; filename=\"%s\"", filename)),
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload media: %w", err)
	}

	// Generate public URL
	publicURL := c.getPublicURL(key)

	return publicURL, nil
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

// getPublicURL generates the public URL for a file.
func (c *Client) getPublicURL(key string) string {
	// Parse the public URL base
	u, err := url.Parse(c.publicURL)
	if err != nil {
		// Fallback to simple concatenation
		return fmt.Sprintf("%s/%s/%s", c.publicURL, c.bucket, key)
	}

	// Append bucket and key to path
	u.Path = path.Join(u.Path, c.bucket, key)
	return u.String()
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
		"audio/mpeg":      ".mp3",
		"audio/ogg":       ".ogg",
		"audio/wav":       ".wav",
		"audio/webm":      ".webm",
		"audio/aac":       ".aac",
		"audio/mp4":       ".m4a",
		"audio/x-m4a":     ".m4a",
		"audio/amr":       ".amr",
		"audio/opus":      ".opus",
		"audio/ogg;codecs=opus": ".opus",

		// Documents
		"application/pdf":                                                               ".pdf",
		"application/msword":                                                            ".doc",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document":       ".docx",
		"application/vnd.ms-excel":                                                      ".xls",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":             ".xlsx",
		"application/vnd.ms-powerpoint":                                                 ".ppt",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation":     ".pptx",
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
