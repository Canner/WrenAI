package utils

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"

	"github.com/Canner/WrenAI/wren-launcher/config"
	"github.com/docker/cli/cli/command"
	"github.com/docker/cli/cli/flags"
	cmdCompose "github.com/docker/compose/v2/cmd/compose"
	"github.com/docker/compose/v2/pkg/api"
	"github.com/docker/compose/v2/pkg/compose"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/google/uuid"
	"github.com/pterm/pterm"
)

const (
	// please change the version when the version is updated
	WREN_PRODUCT_VERSION    string = "0.15.2"
	DOCKER_COMPOSE_YAML_URL string = "https://raw.githubusercontent.com/Canner/WrenAI/" + WREN_PRODUCT_VERSION + "/docker/docker-compose.yaml"
	DOCKER_COMPOSE_ENV_URL  string = "https://raw.githubusercontent.com/Canner/WrenAI/" + WREN_PRODUCT_VERSION + "/docker/.env.example"
	AI_SERVICE_CONFIG_URL   string = "https://raw.githubusercontent.com/Canner/WrenAI/" + WREN_PRODUCT_VERSION + "/docker/config.example.yaml"
)

var generationModelToModelName = map[string]string{
	"gpt-4o-mini": "gpt-4o-mini-2024-07-18",
	"gpt-4o":      "gpt-4o-2024-08-06",
}

func replaceEnvFileContent(content string, projectDir string, openaiApiKey string, openAIGenerationModel string, hostPort int, aiPort int, userUUID string, telemetryEnabled bool) string {
	// replace PROJECT_DIR
	reg := regexp.MustCompile(`PROJECT_DIR=(.*)`)
	str := reg.ReplaceAllString(content, "PROJECT_DIR="+projectDir)

	// replace SHOULD_FORCE_DEPLOY
	reg = regexp.MustCompile(`SHOULD_FORCE_DEPLOY=(.*)`)
	str = reg.ReplaceAllString(str, "SHOULD_FORCE_DEPLOY=1")

	// replace LLM_OPENAI_API_KEY
	reg = regexp.MustCompile(`LLM_OPENAI_API_KEY=(.*)`)
	str = reg.ReplaceAllString(str, "LLM_OPENAI_API_KEY="+openaiApiKey)

	// replace EMBEDDER_OPENAI_API_KEY
	reg = regexp.MustCompile(`EMBEDDER_OPENAI_API_KEY=(.*)`)
	str = reg.ReplaceAllString(str, "EMBEDDER_OPENAI_API_KEY="+openaiApiKey)

	// replace GENERATION_MODEL
	// it seems like using for telemetry to know the model, might be we can remove this in the future and provide a endpoint to get the information
	reg = regexp.MustCompile(`GENERATION_MODEL=(.*)`)
	str = reg.ReplaceAllString(str, "GENERATION_MODEL="+openAIGenerationModel)

	// replace USER_UUID
	reg = regexp.MustCompile(`USER_UUID=(.*)`)
	str = reg.ReplaceAllString(str, "USER_UUID="+userUUID)

	// replace PORT
	reg = regexp.MustCompile(`HOST_PORT=(.*)`)
	str = reg.ReplaceAllString(str, "HOST_PORT="+fmt.Sprintf("%d", hostPort))

	// replace AI_SERVICE_FORWARD_PORT
	reg = regexp.MustCompile(`AI_SERVICE_FORWARD_PORT=(.*)`)
	str = reg.ReplaceAllString(str, "AI_SERVICE_FORWARD_PORT="+fmt.Sprintf("%d", aiPort))

	// replace TELEMETRY_ENABLED
	reg = regexp.MustCompile(`TELEMETRY_ENABLED=(.*)`)
	str = reg.ReplaceAllString(str, "TELEMETRY_ENABLED="+fmt.Sprintf("%t", telemetryEnabled))

	// replace EXPERIMENTAL_ENGINE_RUST_VERSION
	reg = regexp.MustCompile(`EXPERIMENTAL_ENGINE_RUST_VERSION=(.*)`)
	str = reg.ReplaceAllString(str, "EXPERIMENTAL_ENGINE_RUST_VERSION="+fmt.Sprintf("%t", config.IsExperimentalEngineRustVersion()))

	// replace PLATFORM
	reg = regexp.MustCompile(`PLATFORM=(.*)`)
	str = reg.ReplaceAllString(str, "PLATFORM="+fmt.Sprintf("%s", config.GetPlatform()))

	return str
}

func downloadFile(filepath string, url string) error {

	// Get the data
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Create the file
	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	// Write the body to file
	_, err = io.Copy(out, resp.Body)
	return err
}

func CheckDockerDaemonRunning() (bool, error) {
	ctx := context.Background()
	dockerCli, err := command.NewDockerCli()
	if err != nil {
		return false, err
	}

	err = dockerCli.Initialize(flags.NewClientOptions())
	if err != nil {
		return false, err
	}

	_, err = dockerCli.Client().Info(ctx)
	if err != nil {
		return false, err
	}

	return true, nil
}

func prepareUserUUID(projectDir string) (string, error) {
	wrenRC := WrenRC{projectDir}
	err := wrenRC.Set("USER_UUID", uuid.New().String(), false)
	if err != nil {
		return "", err
	}

	userUUID, err := wrenRC.Read("USER_UUID")
	if err != nil {
		return "", err
	}

	return userUUID, nil
}

func PrepareConfigFileForOpenAI(projectDir string, generationModel string) error {
	// download config.yaml file
	configPath := path.Join(projectDir, "config.yaml")
	pterm.Info.Println("Downloading config.yaml file to", configPath)
	err := downloadFile(configPath, AI_SERVICE_CONFIG_URL)
	if err != nil {
		return err
	}

	// read the config.yaml file
	content, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	// replace the generation model in config.yaml
	config := string(content)
	config = strings.ReplaceAll(config, "litellm_llm.gpt-4o-mini-2024-07-18", "litellm_llm."+generationModelToModelName[generationModel])

	// replace allow_using_db_schemas_without_pruning setting
	// enable this feature since OpenAI models have sufficient context window size to handle full schema
	config = strings.ReplaceAll(config, "allow_using_db_schemas_without_pruning: false", "allow_using_db_schemas_without_pruning: true")

	// write back to config.yaml
	err = os.WriteFile(configPath, []byte(config), 0644)
	if err != nil {
		return err
	}

	return nil
}

func mergeEnvContent(newEnvFile string, envFileContent string) (string, error) {
	// Check if .env file does not exist
	if _, err := os.Stat(newEnvFile); err != nil {
		return envFileContent, nil
	}

	// File exists, read existing content
	existingContent, err := os.ReadFile(newEnvFile)
	if err != nil {
		return "", err
	}

	// Split both contents into lines
	existingLines := strings.Split(string(existingContent), "\n")
	newLines := strings.Split(envFileContent, "\n")

	// Create map of existing env vars
	existingEnvVars := make(map[string]string)
	// Helper function to parse env var line
	parseEnvVar := func(line string) (string, string, bool) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			return "", "", false
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			return "", "", false
		}
		return parts[0], parts[1], true
	}

	// Parse existing env vars
	for _, line := range existingLines {
		if key, val, ok := parseEnvVar(line); ok {
			existingEnvVars[key] = val
		}
	}

	// Merge with new values
	for _, line := range newLines {
		if key, val, ok := parseEnvVar(line); ok && val != "" {
			existingEnvVars[key] = val
		}
	}

	// Build merged content
	var mergedLines []string
	for _, line := range newLines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			mergedLines = append(mergedLines, line)
			continue
		}
		if key, _, ok := parseEnvVar(line); ok {
			if val, exists := existingEnvVars[key]; exists {
				mergedLines = append(mergedLines, key+"="+val)
			}
		}
	}

	// Update envFileContent with merged content
	envFileContent = strings.Join(mergedLines, "\n")
	return envFileContent, nil
}

func PrepareDockerFiles(openaiApiKey string, openaiGenerationModel string, hostPort int, aiPort int, projectDir string, telemetryEnabled bool, llmProvider string) error {
	// download docker-compose file
	composeFile := path.Join(projectDir, "docker-compose.yaml")
	pterm.Info.Println("Downloading docker-compose file to", composeFile)
	err := downloadFile(composeFile, DOCKER_COMPOSE_YAML_URL)
	if err != nil {
		return err
	}

	if strings.ToLower(llmProvider) == "openai" {
		userUUID, err := prepareUserUUID(projectDir)
		if err != nil {
			return err
		}

		// download env file
		envExampleFile := path.Join(projectDir, ".env.example")
		pterm.Info.Println("Downloading env file to", envExampleFile)
		err = downloadFile(envExampleFile, DOCKER_COMPOSE_ENV_URL)
		if err != nil {
			return err
		}

		// read the file
		envExampleFileContent, err := os.ReadFile(envExampleFile)
		if err != nil {
			return err
		}

		// replace the content with regex
		envFileContent := replaceEnvFileContent(
			string(envExampleFileContent),
			projectDir,
			openaiApiKey,
			openaiGenerationModel,
			hostPort,
			aiPort,
			userUUID,
			telemetryEnabled,
		)
		newEnvFile := getEnvFilePath(projectDir)

		// merge the env file content with the existing env file
		envFileContent, err = mergeEnvContent(newEnvFile, envFileContent)
		if err != nil {
			return err
		}

		// write the file
		err = os.WriteFile(newEnvFile, []byte(envFileContent), 0644)
		if err != nil {
			return err
		}

		// remove the old env file
		err = os.Remove(envExampleFile)
		if err != nil {
			return err
		}
	} else if strings.ToLower(llmProvider) == "custom" {
		// if .env file does not exist, return error
		if _, err := os.Stat(getEnvFilePath(projectDir)); os.IsNotExist(err) {
			return fmt.Errorf(".env file does not exist, please download the env file from %s to ~/.wrenai, rename it to .env and fill in the required information", DOCKER_COMPOSE_ENV_URL)
		}

		// if config.yaml file does not exist, return error
		if _, err := os.Stat(getConfigFilePath(projectDir)); os.IsNotExist(err) {
			return fmt.Errorf("config.yaml file does not exist, please download the config.yaml file from %s to ~/.wrenai, rename it to config.yaml and fill in the required information", AI_SERVICE_CONFIG_URL)
		}
	}

	return nil
}

func getEnvFilePath(projectDir string) string {
	return path.Join(projectDir, ".env")
}

func getConfigFilePath(projectDir string) string {
	return path.Join(projectDir, "config.yaml")
}

// RunDockerCompose starts Docker services for a project using docker-compose.
// It initializes Docker CLI, checks Docker engine availability, and runs docker-compose up.
// For custom LLM providers, it specifically recreates the wren-ai-service container.
//
// Parameters:
//   - projectName: Name of the Docker Compose project
//   - projectDir: Directory containing docker-compose.yaml and .env files
//   - llmProvider: Type of LLM provider (e.g., "custom" or default)
//
// Returns an error if Docker initialization, configuration, or service startup fails.
// Supports both default and custom LLM provider configurations.
//
// Example:
//
//	err := RunDockerCompose("wren", "/path/to/project", "openai")
func RunDockerCompose(projectName string, projectDir string, llmProvider string) error {
	ctx := context.Background()
	composeFilePath := path.Join(projectDir, "docker-compose.yaml")
	envFile := path.Join(projectDir, ".env")
	envFiles := []string{envFile}
	configPaths := []string{composeFilePath}

	// docker-compose up
	dockerCli, err := command.NewDockerCli()
	if err != nil {
		return err
	}

	err = dockerCli.Initialize(flags.NewClientOptions())
	if err != nil {
		return err
	}

	// check if docker engine is running
	_, err = dockerCli.Client().Info(ctx)
	if err != nil {
		return err
	}

	// Create the compose API service instance with the Docker cli
	apiService := compose.NewComposeService(dockerCli)

	// Create a default project options struct
	projectOptions := cmdCompose.ProjectOptions{
		ProjectName: projectName,
		ConfigPaths: configPaths,
		WorkDir:     projectDir,
		EnvFiles:    envFiles,
	}

	// Turn projectOptions into a project with default values
	projectType, _, err := projectOptions.ToProject(ctx, dockerCli, []string{})
	if err != nil {
		return err
	}

	// Run the up command
	err = apiService.Up(ctx, projectType, api.UpOptions{})
	if err != nil {
		return err
	}

	if strings.ToLower(llmProvider) == "custom" {
		// Create up options for force recreating only wren-ai-service
		upOptions := api.UpOptions{
			Create: api.CreateOptions{
				Recreate: api.RecreateForce,
				Services: []string{"wren-ai-service"},
			},
		}

		// Run the up command with specific options for wren-ai-service
		err = apiService.Up(ctx, projectType, upOptions)
		if err != nil {
			return err
		}
	}

	return nil
}

func listProcess() ([]types.Container, error) {
	ctx := context.Background()
	dockerCli, err := command.NewDockerCli()
	if err != nil {
		return nil, err
	}

	err = dockerCli.Initialize(flags.NewClientOptions())
	if err != nil {
		return nil, err
	}

	containerListOptions := container.ListOptions{
		All: true,
	}

	containers, err := dockerCli.Client().ContainerList(ctx, containerListOptions)
	if err != nil {
		return nil, err
	}

	return containers, nil
}

func findWrenUIContainer() (types.Container, error) {
	containers, err := listProcess()
	if err != nil {
		return types.Container{}, err
	}

	for _, container := range containers {
		// return if com.docker.compose.project == wrenai && com.docker.compose.service=wren-ui
		if container.Labels["com.docker.compose.project"] == "wrenai" && container.Labels["com.docker.compose.service"] == "wren-ui" {
			return container, nil
		}
	}

	return types.Container{}, fmt.Errorf("WrenUI container not found")
}

func findAIServiceContainer() (types.Container, error) {
	containers, err := listProcess()
	if err != nil {
		return types.Container{}, err
	}

	for _, container := range containers {
		if container.Labels["com.docker.compose.project"] == "wrenai" && container.Labels["com.docker.compose.service"] == "wren-ai-service" {
			return container, nil
		}
	}

	return types.Container{}, fmt.Errorf("WrenAI service container not found")
}

func IfPortUsedByWrenUI(port int) bool {
	container, err := findWrenUIContainer()
	if err != nil {
		return false
	}

	for _, containerPort := range container.Ports {
		if containerPort.PublicPort == uint16(port) {
			return true
		}
	}

	return false
}

func IfPortUsedByAIService(port int) bool {
	container, err := findAIServiceContainer()
	if err != nil {
		return false
	}

	for _, containerPort := range container.Ports {
		if containerPort.PublicPort == uint16(port) {
			return true
		}
	}

	return false
}

func CheckUIServiceStarted(url string) error {
	// check response from localhost:3000
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("Wren AI is not started yet")
	}
	return nil
}

func CheckAIServiceStarted(url string) error {
	// health check
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("AI service is not started yet")
	}
	return nil
}
