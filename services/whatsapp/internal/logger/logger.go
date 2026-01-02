package logger

import (
	"fmt"
	"log"
	"os"
	"strings"

	waLog "go.mau.fi/whatsmeow/util/log"
)

// Level represents the log level.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

// Logger implements the waLog.Logger interface for whatsmeow.
type Logger struct {
	module string
	level  Level
	logger *log.Logger
}

// New creates a new Logger with the specified module name.
func New(module string, levelStr string) waLog.Logger {
	level := parseLevel(levelStr)
	return &Logger{
		module: module,
		level:  level,
		logger: log.New(os.Stdout, "", log.LstdFlags),
	}
}

// parseLevel converts a string level to Level type.
func parseLevel(levelStr string) Level {
	switch strings.ToLower(levelStr) {
	case "debug":
		return LevelDebug
	case "info":
		return LevelInfo
	case "warn", "warning":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

// Debugf logs a debug message.
func (l *Logger) Debugf(msg string, args ...interface{}) {
	if l.level <= LevelDebug {
		l.logf("DEBUG", msg, args...)
	}
}

// Infof logs an info message.
func (l *Logger) Infof(msg string, args ...interface{}) {
	if l.level <= LevelInfo {
		l.logf("INFO", msg, args...)
	}
}

// Warnf logs a warning message.
func (l *Logger) Warnf(msg string, args ...interface{}) {
	if l.level <= LevelWarn {
		l.logf("WARN", msg, args...)
	}
}

// Errorf logs an error message.
func (l *Logger) Errorf(msg string, args ...interface{}) {
	if l.level <= LevelError {
		l.logf("ERROR", msg, args...)
	}
}

// Sub creates a sub-logger with the given module name appended.
func (l *Logger) Sub(module string) waLog.Logger {
	return &Logger{
		module: fmt.Sprintf("%s/%s", l.module, module),
		level:  l.level,
		logger: l.logger,
	}
}

// logf formats and outputs the log message.
func (l *Logger) logf(level string, msg string, args ...interface{}) {
	formatted := fmt.Sprintf(msg, args...)
	l.logger.Printf("[%s] [%s] %s", level, l.module, formatted)
}
