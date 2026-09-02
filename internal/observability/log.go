package observability

import (
	"io"

	"github.com/rs/zerolog"
)

func NewLogger(writer io.Writer, service, environment string) zerolog.Logger {
	return zerolog.New(writer).
		Level(zerolog.InfoLevel).
		With().
		Timestamp().
		Str("service", service).
		Str("environment", environment).
		Logger()
}
