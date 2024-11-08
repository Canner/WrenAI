package config

import (
	"flag"
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
	flag.StringVar(&openaiGenerationModel, "openai-generation-model", "", "The OPENAI generation model, valid values are: gpt-4o-mini, gpt-4o")
	flag.BoolVar(&experimentalEngineRustVersion, "experimental-engine-rust-version", false, "Use the experimental Rust version of the Wren Engine")
	flag.StringVar(&platform, "platform", "linux/amd64", "The platform to use, valid values are: linux/amd64, linux/arm64")
}

func IsExperimentalEngineRustVersion() bool {
	return experimentalEngineRustVersion
}

func GetPlatform() string {
	return platform
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
