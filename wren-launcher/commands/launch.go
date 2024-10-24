package commands

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path"
	"strings"
	"time"

	"github.com/Canner/WrenAI/wren-launcher/config"
	utils "github.com/Canner/WrenAI/wren-launcher/utils"
	"github.com/common-nighthawk/go-figure"
	"github.com/manifoldco/promptui"
	"github.com/pterm/pterm"
)

func prepareProjectDir() (string, error) {
	// create a project directory under ~/.wrenai
	homedir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %w", err)
	}

	projectDir := path.Join(homedir, ".wrenai")

	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		if mkdirErr := os.Mkdir(projectDir, 0755); mkdirErr != nil {
			return "", fmt.Errorf("failed to create project directory: %w", mkdirErr)
		}
	}

	return projectDir, nil
}

func evaluateTelemetryPreferences() (bool, error) {
	disableTelemetry := config.IsTelemetryDisabled()
	if disableTelemetry {
		fmt.Println("You have disabled telemetry, Wren AI will not collect any data.")
		return false, nil
	}
	fmt.Println("Wren AI relies on anonymous usage statistics to continuously improve.")
	fmt.Println("You can opt out of sharing these statistics by manually adding the flag `--disable-telemetry` as described at https://docs.getwren.ai/oss/overview/telemetry")
	return true, nil
}

func askForLLMProvider() (string, error) {
	fmt.Println("Please provide the LLM provider you want to use")
	fmt.Println("You can learn more about how to set up custom LLMs at https://docs.getwren.ai/oss/installation/custom_llm#running-wren-ai-with-your-custom-llm-or-document-store")

	prompt := promptui.Select{
		Label: "Select an LLM provider",
		Items: []string{"OpenAI", "Custom"},
	}

	_, result, err := prompt.Run()
	if err != nil {
		return "", fmt.Errorf("failed to select LLM provider: %w", err)
	}

	return result, nil
}

func askForAPIKey() (string, error) {
	fmt.Println("Please provide your OpenAI API key")
	fmt.Println("Please use the key with full permission, more details at https://help.openai.com/en/articles/8867743-assign-api-key-permissions")

	validate := func(input string) error {
		if !strings.HasPrefix(input, "sk-") {
			return errors.New("invalid API key: must start with 'sk-'")
		}
		return nil
	}

	prompt := promptui.Prompt{
		Label:    "OpenAI API key",
		Validate: validate,
		Mask:     '*',
	}

	result, err := prompt.Run()
	if err != nil {
		return "", fmt.Errorf("failed to enter API key: %w", err)
	}

	return result, nil
}

func askForGenerationModel() (string, error) {
	fmt.Println("Please provide the generation model you want to use")
	fmt.Println("You can learn more about OpenAI's generation models at https://platform.openai.com/docs/models/models")

	prompt := promptui.Select{
		Label: "Select an OpenAI generation model",
		Items: []string{"gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"},
	}

	_, result, err := prompt.Run()
	if err != nil {
		return "", fmt.Errorf("failed to select generation model: %w", err)
	}

	return result, nil
}

func isEnvFileValidForCustomLLM(projectDir string) error {
	envFilePath := path.Join(projectDir, ".env.ai")

	if _, err := os.Stat(envFilePath); os.IsNotExist(err) {
		errMessage := fmt.Sprintf("Please create a .env.ai file in %s first. More details at https://docs.getwren.ai/oss/installation/custom_llm#running-wren-ai-with-your-custom-llm-or-document-store", projectDir)
		return errors.New(errMessage)
	}

	return nil
}

func Launch() {
	// Recover from panic and log errors
	defer func() {
		if r := recover(); r != nil {
			pterm.Error.Println("An unexpected error occurred:", r)
			fmt.Scanf("h")
		}
	}()

	// Handle OS signals for graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt)

	go func() {
		for range done {
			pterm.Info.Println("Process interrupted. Exiting...")
			os.Exit(0)
		}
	}()

	fmt.Println(strings.Repeat("=", 55))
	myFigure := figure.NewFigure("WrenAI", "", true)
	myFigure.Print()
	fmt.Println(strings.Repeat("=", 55))

	// Prepare project directory with error handling
	pterm.Info.Println("Preparing project directory")
	projectDir, err := prepareProjectDir()
	if err != nil {
		pterm.Error.Println("Failed to prepare project directory:", err)
		return
	}

	// Ask for LLM provider
	pterm.Print("\n")
	llmProvider, shouldReturn := getLLMProvider()
	if shouldReturn {
		return
	}

	openaiApiKey := ""
	openaiGenerationModel := ""
	if strings.ToLower(llmProvider) == "openai" {
		openaiApiKey, shouldReturn = getOpenaiApiKey()
		if shouldReturn {
			return
		}

		openaiGenerationModel, shouldReturn = getOpenaiGenerationModel()
		if shouldReturn {
			return
		}
	} else {
		err := isEnvFileValidForCustomLLM(projectDir)
		if err != nil {
			pterm.Error.Println("Failed to validate custom LLM:", err)
			return
		}
	}

	// Evaluate telemetry preferences with error handling
	pterm.Print("\n")
	telemetryEnabled, err := evaluateTelemetryPreferences()
	if err != nil {
		pterm.Error.Println("Failed to evaluate telemetry preferences:", err)
		return
	}

	// Check if Docker daemon is running and handle errors
	pterm.Info.Println("Checking if Docker daemon is running")
	for {
		_, err = utils.CheckDockerDaemonRunning()
		if err == nil {
			break
		}
		pterm.Info.Println("Docker daemon is not running, opening Docker Desktop")
		err = utils.OpenDockerDaemon()
		if err != nil {
			pterm.Error.Println("Failed to start Docker daemon:", err)
			return
		}
		time.Sleep(5 * time.Second)
	}

	// Download Docker files with error handling
	pterm.Info.Println("Downloading Docker files")
	uiPort := utils.FindAvailablePort(3000)
	aiPort := utils.FindAvailablePort(5555)
	err = utils.PrepareDockerFiles(openaiApiKey, openaiGenerationModel, uiPort, aiPort, projectDir, telemetryEnabled)
	if err != nil {
		pterm.Error.Println("Failed to prepare Docker files:", err)
		return
	}

	// Launch Wren AI with error handling
	pterm.Info.Println("Launching Wren AI")
	const projectName string = "wrenai"
	err = utils.RunDockerCompose(projectName, projectDir, llmProvider)
	if err != nil {
		pterm.Error.Println("Failed to launch Wren AI:", err)
		return
	}

	// Wait for UI service to be ready with timeout
	pterm.Info.Println("Wren AI is starting, please wait...")
	url := fmt.Sprintf("http://localhost:%d", uiPort)
	timeoutTime := time.Now().Add(2 * time.Minute)
	for {
		if time.Now().After(timeoutTime) {
			pterm.Error.Println("Timeout waiting for UI service to start")
			return
		}
		err := utils.CheckUIServiceStarted(url)
		if err == nil {
			pterm.Info.Println("UI Service is ready")
			break
		}
		time.Sleep(5 * time.Second)
	}

	// Wait for AI service to be ready with timeout
	timeoutTime = time.Now().Add(30 * time.Minute)
	for {
		if time.Now().After(timeoutTime) {
			pterm.Error.Println("Timeout waiting for AI service to start")
			return
		}
		err = utils.CheckAIServiceStarted(aiPort)
		if err == nil {
			pterm.Info.Println("AI Service is ready")
			break
		}
		time.Sleep(5 * time.Second)
	}

	// Open browser with error handling
	pterm.Info.Println("Opening browser")
	if err := utils.OpenBrowser(url); err != nil {
		pterm.Error.Println("Failed to open browser:", err)
		return
	}

	pterm.Info.Println("You can now safely close this terminal window.")
	fmt.Scanf("h")
}

func getOpenaiGenerationModel() (string, bool) {
	openaiGenerationModel := config.GetOpenaiGenerationModel()
	if openaiGenerationModel == "" {
		openaiGenerationModel, _ = askForGenerationModel()
	} else {
		validModels := map[string]bool{
			"gpt-4o-mini":   true,
			"gpt-4o":        true,
			"gpt-4-turbo":   true,
			"gpt-3.5-turbo": true,
		}
		if _, ok := validModels[openaiGenerationModel]; !ok {
			pterm.Error.Println("Invalid generation model specified in the .env file. Please update the .env file.")
			return "", true
		}
	}

	return openaiGenerationModel, false
}

func getOpenaiApiKey() (string, bool) {
	openaiApiKey := config.GetOpenaiApiKey()
	if openaiApiKey == "" {
		openaiApiKey, _ = askForAPIKey()
	} else if !strings.HasPrefix(openaiApiKey, "sk-") {
		pterm.Error.Println("Invalid OpenAI API key specified in the .env file. Please update the .env file.")
		return "", true
	}

	return openaiApiKey, false
}

func getLLMProvider() (string, bool) {
	llmProvider := config.GetLLMProvider()
	if llmProvider == "" {
		llmProvider, _ = askForLLMProvider()
	} else if strings.ToLower(llmProvider) != "openai" && strings.ToLower(llmProvider) != "custom" {
		pterm.Error.Println("Invalid LLM provider specified in the .env file. Please update the .env file.")
		return "", true
	}

	return llmProvider, false
}
