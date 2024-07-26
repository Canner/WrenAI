package config

import (
	"flag"
)

// private variable within the config package
var disableTelemetry bool
var openaiAPIKey string

// InitFlags initializes the flag
func InitFlags() {
	flag.BoolVar(&disableTelemetry, "disable-telemetry", false, "Disable telemetry if set to true")
	flag.StringVar(&openaiAPIKey, "openai-api-key", "", "The OPENAI API key")
}

// IsTelemetryDisabled exposes the state of the telemetry flag
func IsTelemetryDisabled() bool {
	return disableTelemetry
}

func GetOpenaiAPIKey() string {
	return openaiAPIKey
}
