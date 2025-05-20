package config

import (
	"flag"
	"runtime"
)

// private variable within the config package
var disableTelemetry bool
var openaiAPIKey string
var openaiGenerationModel string
var llmProvider string
var experimentalEngineRustVersion bool
var platform string

// InitFlags initializes the flag
func InitFlags() {
	flag.BoolVar(&disableTelemetry, "disable-telemetry", false, "Disable telemetry if set to true")
	flag.StringVar(&llmProvider, "llm-provider", "", "The LLM provider to use, valid values are: openai, custom")
	flag.StringVar(&openaiAPIKey, "openai-api-key", "", "The OPENAI API key")
	flag.StringVar(&openaiGenerationModel, "openai-generation-model", "", "The OPENAI generation model, valid values are: gpt-4.1, gpt-4.1-mini, gpt-4.1-nano")
	flag.BoolVar(&experimentalEngineRustVersion, "experimental-engine-rust-version", true, "Use the experimental Rust version of the Wren Engine")
	flag.StringVar(&platform, "platform", GetPlatform(), "The platform to use, valid values are: linux/amd64, linux/arm64")
}

func IsExperimentalEngineRustVersion() bool {
	return experimentalEngineRustVersion
}

func GetPlatform() string {
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return "linux/arm64"
		}
		return "linux/amd64"
	case "linux":
		if runtime.GOARCH == "arm64" {
			return "linux/arm64"
		}
		return "linux/amd64"
	case "windows":
		return "linux/amd64"  // Windows typically uses amd64
	default:
		return "linux/amd64"  // Default to amd64 for unknown platforms
	}
}

// IsTelemetryDisabled exposes the state of the telemetry flag
func IsTelemetryDisabled() bool {
	return disableTelemetry
}

func GetOpenaiAPIKey() string {
	return openaiAPIKey
}

func GetOpenaiGenerationModel() string {
	return openaiGenerationModel
}

func GetLLMProvider() string {
	return llmProvider
}
