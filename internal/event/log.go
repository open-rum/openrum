package event

// ValidLogLevel is shared by the normalizer and the query boundary.
func ValidLogLevel(level string) bool {
	switch level {
	case "trace", "debug", "info", "warn", "error", "fatal":
		return true
	default:
		return false
	}
}
