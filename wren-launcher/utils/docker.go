package utils

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
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
	WREN_PRODUCT_VERSION    string = "0.22.2"
	DOCKER_COMPOSE_YAML_URL string = "https://raw.githubusercontent.com/Canner/WrenAI/" + WREN_PRODUCT_VERSION + "/docker/docker-compose.yaml"
	DOCKER_COMPOSE_ENV_URL  string = "https://raw.githubusercontent.com/Canner/WrenAI/" + WREN_PRODUCT_VERSION + "/docker/.env.example"
	AI_SERVICE_CONFIG_URL   string = "https://raw.githubusercontent.com/Canner/WrenAI/" + WREN_PRODUCT_VERSION + "/docker/config.example.yaml"
)

var generationModelToModelName = map[string]string{
	"gpt-4.1":      "gpt-4.1-2025-04-14",
	"gpt-4.1-mini": "gpt-4.1-mini-2025-04-14",
	"gpt-4.1-nano": "gpt-4.1-nano-2025-04-14",
}

func replaceEnvFileContent(content string, projectDir string, openaiApiKey string, openAIGenerationModel string, hostPort int, aiPort int, userUUID string, telemetryEnabled bool, platform string) string {
	// replace PLATFORM
	reg := regexp.MustCompile(`PLATFORM=(.*)`)
	str := reg.ReplaceAllString(content, "PLATFORM="+platform)

	// replace PROJECT_DIR
	reg = regexp.MustCompile(`PROJECT_DIR=(.*)`)
	str = reg.ReplaceAllString(str, "PROJECT_DIR="+projectDir)

	// replace SHOULD_FORCE_DEPLOY
	reg = regexp.MustCompile(`SHOULD_FORCE_DEPLOY=(.*)`)
	str = reg.ReplaceAllString(str, "SHOULD_FORCE_DEPLOY=1")

	// replace OPENAI_API_KEY
	reg = regexp.MustCompile(`OPENAI_API_KEY=(.*)`)
	str = reg.ReplaceAllString(str, "OPENAI_API_KEY="+openaiApiKey)

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
	// gpt-4.1-nano is the default model, so we don't need to replace it
	if generationModel != "gpt-4.1-nano" {
		config = strings.ReplaceAll(config, "litellm_llm.default", "litellm_llm."+generationModelToModelName[generationModel])
	}

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

func PrepareDockerFiles(openaiApiKey string, openaiGenerationModel string, hostPort int, aiPort int, projectDir string, telemetryEnabled bool, llmProvider string, platform string) error {
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
			platform,
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

		// Generate or load existing USER_UUID
		userUUID, err := prepareUserUUID(projectDir)
		if err != nil {
			return err
		}

		// Ensure .env exists (download if missing)
		envFilePath := getEnvFilePath(projectDir)
		if _, err := os.Stat(envFilePath); os.IsNotExist(err) {
			pterm.Println(".env file not found, downloading from default URL...")
			err = downloadFile(envFilePath, DOCKER_COMPOSE_ENV_URL)
			if err != nil {
				return fmt.Errorf("failed to download .env: %v", err)
			}

			// Read downloaded .env content
			contentBytes, err := os.ReadFile(envFilePath)
			if err != nil {
				return fmt.Errorf("failed to read .env: %v", err)
			}
			str := string(contentBytes)

			// Replace or append USER_UUID
			reg := regexp.MustCompile(`(?m)^USER_UUID=.*$`)
			if reg.MatchString(str) {
				str = reg.ReplaceAllString(str, "USER_UUID="+userUUID)
			} else {
				str = str + "\nUSER_UUID=" + userUUID + "\n"
			}

			// Save updated .env file
			err = os.WriteFile(envFilePath, []byte(str), 0644)
			if err != nil {
				return fmt.Errorf("failed to write updated .env: %v", err)
			}
		}

		// Ensure config.yaml exists (download if missing)
		configFilePath := getConfigFilePath(projectDir)
		if _, err := os.Stat(configFilePath); os.IsNotExist(err) {
			pterm.Println("config.yaml not found, downloading from default URL...")
			err = downloadFile(configFilePath, AI_SERVICE_CONFIG_URL)
			if err != nil {
				return fmt.Errorf("failed to download config.yaml: %v", err)
			}
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

func TryGetWrenAIDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	wrenDir := path.Join(homeDir, ".wrenai")

	info, err := os.Stat(wrenDir)
	if err != nil || !info.IsDir() {
		return "", nil
	}
	return wrenDir, nil
}

func ensureFileExists(filePath string, defaultContent []byte) error {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return os.WriteFile(filePath, defaultContent, 0644)
	}
	return nil
}

// RunStreamlitUIContainer builds and runs the Streamlit UI container.
// It ensures that config.yaml, .env, and config.done are mounted,
// and initializes config.done with 'false' for setup flow control.
func RunStreamlitUIContainer() error {

	// Build the Docker image for the Streamlit UI
	if err := buildStreamlitImage(); err != nil {
		return err
	}

	// Get ~/.wrenai directory
	wrenAIDir, err := TryGetWrenAIDir()
	if err != nil {
		return fmt.Errorf("failed to get ~/.wrenai: %v", err)
	}

	// Initialize config.done with 'false'
	donePath, err := prepareConfigDoneFile(wrenAIDir)
	if err != nil {
		return fmt.Errorf("failed to write to config.done: %v", err)
	}

	// Mount user config.yaml and .env for the UI to read/write
	configPath, envPath, _ := getMountPaths(wrenAIDir)
	_ = ensureFileExists(configPath, []byte("# Create a temporary yaml file"))
	_ = ensureFileExists(envPath, []byte("# Put your API keys here\n"))

	// run docker and mount volume
	if err := runStreamlitContainer(configPath, envPath, donePath); err != nil {
		return err
	}

	return nil
}

func buildStreamlitImage() error {
	cmd := exec.Command("docker", "build", "-t", "wrenai-providers-setup", "../wren-ai-service/tools/providers-setup")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("build failed: %v\n%s", err, output)
	}
	return nil
}

// prepareConfigDoneFile creates or overwrites the config.done file,
// marking the UI configuration state as "not finished" by default ("false").
// Returns the full path to config.done and any error.
func prepareConfigDoneFile(wrenAIDir string) (string, error) {
	donePath := path.Join(wrenAIDir, "config.done")
	err := os.WriteFile(donePath, []byte("false"), 0644)
	if err != nil {
		return "", fmt.Errorf("❌ Failed to write config.done: %v", err)
	}
	return donePath, nil
}

func getMountPaths(wrenDir string) (string, string, string) {
	return path.Join(wrenDir, "config.yaml"),
		path.Join(wrenDir, ".env"),
		path.Join(wrenDir, "config.done")
}

// runStreamlitContainer starts the Streamlit UI Docker container with the given bind-mount paths.
// It maps port 8501 and runs the container in detached mode.
// Returns an error if the container fails to start.
func runStreamlitContainer(configPath, envPath, donePath string) error {
	cmd := exec.Command("docker", "run", "--rm", "-d",
		"-p", "8501:8501",
		"--name", "wrenai-providers-setup",
		"-v", configPath+":/app/data/config.yaml",
		"-v", envPath+":/app/data/.env",
		"-v", donePath+":/app/data/config.done",
		"wrenai-providers-setup",
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("❌ Failed to run providers-setup UI container: %v\n%s", err, output)
	}
	return nil
}

// RemoveContainerIfExists forcibly removes the specified Docker container
// if it currently exists (running or stopped). Logs the removal result.
func RemoveContainerIfExists(name string) error {
	// Check if the container exists (inspect will fail if not)
	err := exec.Command("docker", "inspect", name).Run()
	if err != nil {
		pterm.Info.Println("🔍 Container does not exist, skipping:", name)
		return nil
	}

	// Remove container forcefully
	cmd := exec.Command("docker", "rm", "-f", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("❌ Failed to force-remove container: %v\n%s", err, string(out))
	}

	pterm.Info.Println("🧹 Container forcibly removed:", name)
	return nil
}

// IsCustomConfigReady checks whether the config.done file contains 'true',
// indicating that the Streamlit configuration process is complete.
func IsCustomConfigReady() bool {
	wrenAIDir, err := TryGetWrenAIDir()
	if err != nil {
		return false
	}

	configDonePath := path.Join(wrenAIDir, "config.done")
	data, err := os.ReadFile(configDonePath)
	if err != nil {
		return false
	}

	// Trim whitespace and compare case-insensitively
	trimmed := strings.TrimSpace(string(data))
	return strings.EqualFold(trimmed, "true")
}
