package config

import (
	"flag"
)

// private variable within the config package
var disableTelemetry bool
var openaiAPIKey string
var openaiGenerationModel string
var llmProvider string

// InitFlags initializes the flag
func InitFlags() {
	flag.BoolVar(&disableTelemetry, "disable-telemetry", false, "Disable telemetry if set to true")
	flag.StringVar(&llmProvider, "llm-provider", "", "The LLM provider to use, valid values are: openai, custom")
	flag.StringVar(&openaiAPIKey, "openai-api-key", "", "The OPENAI API key")
	flag.StringVar(&openaiGenerationModel, "openai-generation-model", "", "The OPENAI generation model, valid values are: gpt-4o-mini, gpt-4o, gpt-4-turbo, gpt-3.5-turbo")
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
