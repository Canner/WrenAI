package commands

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/Canner/WrenAI/wren-launcher/config"
	utils "github.com/Canner/WrenAI/wren-launcher/utils"
	"github.com/common-nighthawk/go-figure"
	"github.com/manifoldco/promptui"
	"github.com/pterm/pterm"
	openai "github.com/sashabaranov/go-openai"
)

func prepareProjectDir() string {
	// create a project directory under ~/.wrenai
	homedir, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}

	projectDir := path.Join(homedir, ".wrenai")

	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		if err := os.Mkdir(projectDir, 0750); err != nil {
			return ""
		}
	}

	return projectDir
}

func evaluateTelemetryPreferences() (bool, error) {
	// let users know we're asking for telemetry consent
	disableTelemetry := config.IsTelemetryDisabled()
	if disableTelemetry {
		fmt.Println("You have disabled telemetry, Wren AI will not collect any data.")
		return false, nil
	}
	fmt.Println("Wren AI relies on anonymous usage statistics to continuously improve.")
	fmt.Println("You can opt out of sharing these statistics by manually adding flag `--disable-telemetry` as described at https://docs.getwren.ai/oss/overview/telemetry")
	return true, nil
}

func askForLLMProvider() (string, error) {
	// let users know we're asking for a LLM provider
	pterm.Warning.Println("We highly recommend using OpenAI models with Wren AI, especially the latest models.")
	pterm.Warning.Println("These models have been extensively tested to ensure optimal performance and compatibility.")
	pterm.Warning.Println("While it is technically possible to integrate other AI models, please note that they have not been fully tested with our system.")
	pterm.Warning.Println("Therefore, using alternative models is at your own risk and may result in unexpected behavior or suboptimal performance.")
	fmt.Println("")
	fmt.Println("Please provide the LLM provider you want to use")
	fmt.Println("You can learn more about how to set up custom LLMs at https://docs.getwren.ai/oss/ai_service/guide/custom_llm#running-wren-ai-with-your-custom-llm-or-document-store")

	prompt := promptui.Select{
		Label: "Select an LLM provider",
		Items: []string{"OpenAI", "Custom"},
	}

	_, result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func askForAPIKey() (string, error) {
	// let users know we're asking for an API key
	fmt.Println("Please provide your OpenAI API key")
	fmt.Println("Please use the key with full permission, more details at https://help.openai.com/en/articles/8867743-assign-api-key-permissions")

	validate := func(input string) error {
		// check if input is a valid API key
		// OpenAI API keys are starting with "sk-"
		if !strings.HasPrefix(input, "sk-") {
			return errors.New("invalid API key")
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
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func askForGenerationModel() (string, error) {
	// let users know we're asking for a generation model
	fmt.Println("Please provide the generation model you want to use")
	fmt.Println("You can learn more about OpenAI's generation models at https://platform.openai.com/docs/models/models")

	prompt := promptui.Select{
		Label: "Select an OpenAI's generation model",
		Items: []string{"gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-5", "gpt-5-mini", "gpt-5-nano"},
	}

	_, result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func askForDbtProjectPath() (string, error) {
	// let users know we're asking for a dbt project path
	fmt.Println("Please provide the dbt project path you want to convert")
	fmt.Println("This should be the root directory of your dbt project containing dbt_project.yml")
	fmt.Println("Press Enter to ignore this step if you don't have a dbt project to convert.")

	prompt := promptui.Prompt{
		Label:   "dbt project path (leave empty to skip)",
		Default: "",
	}

	result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func askForDbtProfileName() (string, error) {
	// let users know we're asking for a dbt profile name
	fmt.Println("Please provide the dbt profile name you want to use")
	fmt.Println("This should be the profile name defined in your profiles.yml file")
	fmt.Println("Press Enter to use the default profile.")

	prompt := promptui.Prompt{
		Label:   "dbt profile name (leave empty to use default)",
		Default: "",
	}

	result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func askForDbtTarget() (string, error) {
	// let users know we're asking for a dbt target
	fmt.Println("Please provide the dbt target you want to use")
	fmt.Println("This should be the target name defined in your profiles.yml file")
	fmt.Println("Press Enter to use the default target.")

	prompt := promptui.Prompt{
		Label:   "dbt target (leave empty to use default)",
		Default: "",
	}

	result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func askForIncludeStagingModels() (bool, error) {
	prompt := promptui.Select{
		Label: "Include staging models (stg_*, staging_*)?",
		Items: []string{"No", "Yes"},
	}
	_, result, err := prompt.Run()
	if err != nil {
		return false, err
	}
	return result == "Yes", nil
}

func Launch() {
	// recover from panic
	defer func() {
		if r := recover(); r != nil {
			pterm.Error.Println("An error occurred:", r)
			var dummy string
			_, _ = fmt.Scanf("%s", &dummy)
		}
	}()

	// Setup a channel to receive a signal
	done := make(chan os.Signal, 1)

	signal.Notify(done, os.Interrupt)

	// Fire off a goroutine to loop until that channel receives a signal.
	// When a signal is received simply exit the program
	go func() {
		for range done {
			os.Exit(0)
		}
	}()
	// print Wren AI header
	fmt.Println(strings.Repeat("=", 55))
	myFigure := figure.NewFigure("WrenAI", "", true)
	myFigure.Print()
	fmt.Println(strings.Repeat("=", 55))

	// prepare a project directory
	pterm.Info.Println("Preparing project directory")
	projectDir := prepareProjectDir()

	// get platform
	platform := config.GetPlatform()
	if platform != "linux/amd64" && platform != "linux/arm64" {
		pterm.Error.Println("Invalid platform, valid values are: linux/amd64, linux/arm64")
		os.Exit(1)
	}
	pterm.Info.Println("Platform: ", platform)

	// get experimental engine rust version
	experimentalEngineRustVersion := config.IsExperimentalEngineRustVersion()
	pterm.Info.Println("Use Experimental Rust Engine: ", experimentalEngineRustVersion)

	// ask for LLM provider
	pterm.Print("\n")
	llmProvider, shouldReturn := getLLMProvider()
	if shouldReturn {
		return
	}
	openaiApiKey := ""
	openaiGenerationModel := ""
	if strings.ToLower(llmProvider) == "openai" {
		// if openaiApiKey is not provided, ask for it
		// ask for OpenAI API key
		openaiApiKey, shouldReturn = getOpenaiApiKey()
		if shouldReturn {
			return
		}

		// check if OpenAI API key is valid
		shouldReturn = validateOpenaiApiKey(openaiApiKey)
		if shouldReturn {
			return
		}

		// ask for OpenAI generation model
		pterm.Print("\n")
		openaiGenerationModel, shouldReturn = getOpenaiGenerationModel()
		if shouldReturn {
			return
		}

		// prepare config.yaml file for OpenAI
		err := utils.PrepareConfigFileForOpenAI(projectDir, openaiGenerationModel)
		if err != nil {
			panic(err)
		}
	}

	// ask for telemetry consent
	pterm.Print("\n")
	telemetryEnabled, err := evaluateTelemetryPreferences()

	if err != nil {
		pterm.Error.Println("Failed to get API key")
		panic(err)
	}

	// check if docker daemon is running, if not, open it and loop to check again
	pterm.Info.Println("Checking if Docker daemon is running")
	for {
		_, err = utils.CheckDockerDaemonRunning()
		if err == nil {
			break
		}

		pterm.Info.Println("Docker daemon is not running, opening Docker Desktop")
		err = utils.OpenDockerDaemon()
		if err != nil {
			panic(err)
		}

		time.Sleep(5 * time.Second)
	}

	// download docker-compose file and env file template for Wren AI
	pterm.Info.Println("Downloading docker-compose file and env file")
	// find an available port
	uiPort := utils.FindAvailablePort(3000)
	aiPort := utils.FindAvailablePort(5555)

	var localStorage string
	if config.IsDbtEnabled() {
		localStorage, err = processDbtProject(projectDir)
		if err != nil {
			pterm.Error.Println("Failed to process dbt project:", err)
			panic(err)
		}
	} else {
		localStorage = ""
	}
	// process dbt project conversion

	err = utils.PrepareDockerFiles(
		openaiApiKey,
		openaiGenerationModel,
		uiPort,
		aiPort,
		projectDir,
		telemetryEnabled,
		llmProvider,
		platform,
		localStorage,
	)
	if err != nil {
		panic(err)
	}

	// launch Wren AI
	pterm.Info.Println("Launching Wren AI")
	const projectName string = "wrenai"
	err = utils.RunDockerCompose(projectName, projectDir, llmProvider)
	if err != nil {
		panic(err)
	}

	pterm.Info.Println("Wren AI is starting, please wait for a moment...")
	uiUrl := fmt.Sprintf("http://localhost:%d", uiPort)
	aiUrl := fmt.Sprintf("http://localhost:%d", aiPort)
	// wait until checking if CheckUIServiceStarted return without error
	// if timeout 2 minutes, panic
	timeoutTime := time.Now().Add(2 * time.Minute)
	for {
		if time.Now().After(timeoutTime) {
			panic("Timeout")
		}

		// check if ui is ready
		err := utils.CheckUIServiceStarted(uiUrl)
		if err == nil {
			pterm.Info.Println("UI Service is ready")
			break
		}
		time.Sleep(5 * time.Second)
	}

	// wait until checking if CheckWrenAIStarted return without error
	// if timeout 30 minutes, panic
	timeoutTime = time.Now().Add(30 * time.Minute)
	for {
		if time.Now().After(timeoutTime) {
			panic("Timeout")
		}

		// check if ai service is ready
		err := utils.CheckAIServiceStarted(aiUrl)
		if err == nil {
			pterm.Info.Println("AI Service is Ready")
			break
		}
		time.Sleep(5 * time.Second)
	}

	// open browser
	pterm.Info.Println("Opening browser")
	_ = utils.Openbrowser(uiUrl)

	pterm.Info.Println("You can now safely close this terminal window")
	var dummy string
	_, _ = fmt.Scanf("%s", &dummy)
}

func getOpenaiGenerationModel() (string, bool) {
	// get openai generation model from initialize arguments
	openaiGenerationModel := config.GetOpenaiGenerationModel()
	if openaiGenerationModel == "" {
		// not provided in args, ask user to provide openai generation model
		openaiGenerationModel, _ = askForGenerationModel()
	} else {
		// validate if input args is a valid generation model
		pterm.Info.Println("OpenAI generation model is provided")
		validModels := map[string]bool{
			"gpt-4.1":      true,
			"gpt-4.1-mini": true,
			"gpt-4.1-nano": true,
			"gpt-5":        true,
			"gpt-5-mini":   true,
			"gpt-5-nano":   true,
		}
		if !validModels[openaiGenerationModel] {
			pterm.Error.Println("Invalid generation model", openaiGenerationModel)
			return "", true
		}
	}
	return openaiGenerationModel, false
}

func getOpenaiApiKey() (string, bool) {
	// get openai api key from initialize arguments
	openaiApiKey := config.GetOpenaiAPIKey()

	if openaiApiKey == "" {
		// not provided in args, ask user to provide openai api key
		pterm.Print("\n")
		openaiApiKey, _ = askForAPIKey()
	} else {
		// validate if input args is a valid API key
		if !strings.HasPrefix(openaiApiKey, "sk-") {
			pterm.Error.Println("Invalid API key, API key should start with 'sk-'")
			return "", true
		}
		pterm.Info.Println("OpenAI API key is provided")
	}
	return openaiApiKey, false
}

func getLLMProvider() (string, bool) {
	// get llm provider from initialize arguments
	llmProvider := config.GetLLMProvider()
	if llmProvider == "" {
		// not provided in args, ask user to provide llm provider
		result, err := askForLLMProvider()
		if err != nil {
			panic(err)
		}
		llmProvider = result
	} else {
		// validate if input args is a valid LLM provider
		validProvider := map[string]bool{
			"openai": true,
			"custom": true,
		}
		if !validProvider[llmProvider] {
			pterm.Error.Println("Invalid LLM provider", llmProvider, "valid values are: openai, custom")
			return "", true
		}
	}
	return llmProvider, false
}

func validateOpenaiApiKey(apiKey string) bool {
	// validate if input api key is valid by sending a hello request
	pterm.Info.Println("Sending a hello request to OpenAI...")
	client := openai.NewClient(apiKey)
	resp, err := client.CreateChatCompletion(
		context.Background(),
		openai.ChatCompletionRequest{
			Model: openai.GPT4oMini20240718,
			Messages: []openai.ChatCompletionMessage{
				{
					Role:    openai.ChatMessageRoleUser,
					Content: "Hello!",
				},
			},
		},
	)

	// insufficient credit balance error
	if err != nil {
		pterm.Error.Println("Invalid API key", err)
		_, _ = fmt.Scanln()
		return true
	}

	pterm.Info.Println("Valid API key, Response:", resp.Choices[0].Message.Content)
	return false
}

func getDbtProfileAndTarget() (string, string, error) {
	// ask for profile name and target
	profileName, err := askForDbtProfileName()
	if err != nil {
		return "", "", fmt.Errorf("failed to get dbt profile name: %w", err)
	}

	// if profile name is empty, doesn't ask for target
	var target string
	if profileName == "" {
		target = "" // use default target
	} else {
		target, err = askForDbtTarget()
		if err != nil {
			return "", "", fmt.Errorf("failed to get dbt target: %w", err)
		}
	}
	return profileName, target, nil
}

func processDbtProject(projectDir string) (string, error) {
	// ask for dbt project path
	dbtProjectPath, err := askForDbtProjectPath()
	if err != nil {
		return "", fmt.Errorf("failed to get dbt project path: %w", err)
	}

	// if user provides empty path, skip dbt conversion
	if strings.TrimSpace(dbtProjectPath) == "" {
		pterm.Info.Println("Skipping dbt project conversion")
		return ".", nil // return default local storage path
	}

	// create target directory in project dir
	targetDir := filepath.Join(projectDir, "target")
	err = os.MkdirAll(targetDir, 0750)
	if err != nil {
		return "", fmt.Errorf("failed to create target directory: %w", err)
	}

	profileName, target, err := getDbtProfileAndTarget()
	if err != nil {
		return "", err
	}

	// Ask the user whether to include staging models
	includeStagingModels, err := askForIncludeStagingModels()
	if err != nil {
		pterm.Warning.Println("Could not get staging model preference, defaulting to 'No'.")
		includeStagingModels = false
	}

	// Use the core conversion function from dbt package, passing the user's choice
	result, err := DbtConvertProject(dbtProjectPath, targetDir, profileName, target, true, includeStagingModels)
	if err != nil {
		return "", fmt.Errorf("failed to convert dbt project: %w", err)
	}

	pterm.Info.Printf("Successfully processed dbt project to target directory: %s\n", targetDir)

	return result.LocalStoragePath, nil
}
