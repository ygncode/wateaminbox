// Package config provides utilities for reading configuration from environment variables.
package config

import (
	"log"
	"net/url"
	"os"
	"strconv"
	"time"
)

// GetEnv returns the value of an environment variable or a default value if not set.
func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// RedactURL removes user information before a service URL is logged.
func RedactURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return "[invalid URL]"
	}
	parsed.User = nil
	return parsed.String()
}

// GetEnvRequired returns the value of an environment variable or panics if not set.
func GetEnvRequired(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("Required environment variable %s is not set", key)
	}
	return value
}

// GetDurationEnv returns a duration from an environment variable or a default value.
// The environment variable should be in Go duration format (e.g., "30s", "5m", "1h").
func GetDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		d, err := time.ParseDuration(value)
		if err != nil {
			log.Printf("Invalid duration for %s: %v, using default %v", key, err, defaultValue)
			return defaultValue
		}
		return d
	}
	return defaultValue
}

// GetIntEnv returns an integer from an environment variable or a default value.
func GetIntEnv(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		i, err := strconv.Atoi(value)
		if err != nil {
			log.Printf("Invalid integer for %s: %v, using default %d", key, err, defaultValue)
			return defaultValue
		}
		return i
	}
	return defaultValue
}

// GetInt64Env returns an int64 from an environment variable or a default value.
func GetInt64Env(key string, defaultValue int64) int64 {
	if value := os.Getenv(key); value != "" {
		i, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			log.Printf("Invalid int64 for %s: %v, using default %d", key, err, defaultValue)
			return defaultValue
		}
		return i
	}
	return defaultValue
}

// GetBoolEnv returns a boolean from an environment variable or a default value.
// Accepts "true", "1", "yes" (case-insensitive) as true values.
func GetBoolEnv(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		b, err := strconv.ParseBool(value)
		if err != nil {
			log.Printf("Invalid boolean for %s: %v, using default %t", key, err, defaultValue)
			return defaultValue
		}
		return b
	}
	return defaultValue
}
