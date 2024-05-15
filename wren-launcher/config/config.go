package config

import (
	"flag"
)

// private variable within the config package
var disableTelemetry bool

// InitFlags initializes the flag
func InitFlags() {
	flag.BoolVar(&disableTelemetry, "disable-telemetry", false, "Disable telemetry if set to true")
}

// IsTelemetryDisabled exposes the state of the telemetry flag
func IsTelemetryDisabled() bool {
	return disableTelemetry
}
