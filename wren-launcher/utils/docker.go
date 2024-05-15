package utils

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"

	"github.com/docker/cli/cli/command"
	"github.com/docker/cli/cli/flags"
	cmdCompose "github.com/docker/compose/v2/cmd/compose"
	"github.com/docker/compose/v2/pkg/api"
	"github.com/docker/compose/v2/pkg/compose"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/google/uuid"
	"github.com/pterm/pterm"

	"github.com/sethvargo/go-password/password"
)

const (
	DOCKER_COMPOSE_YAML_URL string = "https://gist.githubusercontent.com/wwwy3y3/5fee68a54458a07abbeb573711652292/raw/d388eb84caac180174afe87274f57d9b46973ec7/docker-compose.yaml"
	DOCKER_COMPOSE_ENV_URL  string = "https://gist.githubusercontent.com/wwwy3y3/5fee68a54458a07abbeb573711652292/raw/d388eb84caac180174afe87274f57d9b46973ec7/.env.example"

	// pg user
	PG_USERNAME string = "wren-user"
)

func replaceEnvFileContent(content string, OpenaiApiKey string, OpenaiGenerationModel string, hostPort int, aiPort int, pg_password string, userUUID string, telemetryEnabled bool) string {
	// replace OPENAI_API_KEY
	reg := regexp.MustCompile(`OPENAI_API_KEY=sk-(.*)`)
	str := reg.ReplaceAllString(content, "OPENAI_API_KEY="+OpenaiApiKey)

	// replace OPENAI_GENERATION_MODEL
	reg = regexp.MustCompile(`OPENAI_GENERATION_MODEL=(.*)`)
	str = reg.ReplaceAllString(str, "OPENAI_GENERATION_MODEL="+OpenaiGenerationModel)

	// replace USER_UUID
	reg = regexp.MustCompile(`USER_UUID=(.*)`)
	str = reg.ReplaceAllString(str, "USER_UUID="+userUUID)

	// replace PORT
	reg = regexp.MustCompile(`HOST_PORT=(.*)`)
	str = reg.ReplaceAllString(str, "HOST_PORT="+fmt.Sprintf("%d", hostPort))

	// replace AI_SERVICE_FORWARD_PORT
	reg = regexp.MustCompile(`AI_SERVICE_FORWARD_PORT=(.*)`)
	str = reg.ReplaceAllString(str, "AI_SERVICE_FORWARD_PORT="+fmt.Sprintf("%d", aiPort))

	// replace PG_PASSWORD
	reg = regexp.MustCompile(`PG_PASSWORD=(.*)`)
	str = reg.ReplaceAllString(str, "PG_PASSWORD="+pg_password)

	// replace PG_USERNAME
	reg = regexp.MustCompile(`PG_USERNAME=(.*)`)
	str = reg.ReplaceAllString(str, "PG_USERNAME="+PG_USERNAME)

	// replace TELEMETRY_ENABLED
	reg = regexp.MustCompile(`TELEMETRY_ENABLED=(.*)`)
	str = reg.ReplaceAllString(str, "TELEMETRY_ENABLED="+fmt.Sprintf("%t", telemetryEnabled))

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

func getPGPassword(w WrenRC) (string, error) {
	pgPwdKey := "pg_password"
	// get the password from rc file if exists
	// if not exists, generate a new password
	pgPwd, err := w.Read(pgPwdKey)
	if err != nil {
		return "", err
	}

	if pgPwd == "" {
		genPwd, err := password.Generate(10, 2, 0, false, false)
		if err != nil {
			return "", err
		}

		// set the password to rc file
		err = w.Set(pgPwdKey, genPwd, false)
		if err != nil {
			return "", err
		}

		// return the generated password
		return genPwd, nil
	}

	// return the password from rc file
	return pgPwd, nil
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

func PrepareDockerFiles(openaiApiKey string, openaiGenerationModel string, hostPort int, aiPort int, projectDir string, telemetryEnabled bool) error {
	// download docker-compose file
	composeFile := path.Join(projectDir, "docker-compose.yaml")
	pterm.Info.Println("Downloading docker-compose file to", composeFile)
	err := downloadFile(composeFile, DOCKER_COMPOSE_YAML_URL)
	if err != nil {
		return err
	}

	pg_pwd, err := getPGPassword(WrenRC{projectDir})
	if err != nil {
		return err
	}

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
	envFileContent := replaceEnvFileContent(string(envExampleFileContent), openaiApiKey, openaiGenerationModel, hostPort, aiPort, pg_pwd, userUUID, telemetryEnabled)
	newEnvFile := getEnvFilePath(projectDir)
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

	return nil
}

func getEnvFilePath(projectDir string) string {
	return path.Join(projectDir, ".env")
}

func RunDockerCompose(projectName string, projectDir string) error {
	ctx := context.Background()
	composeFilePath := path.Join(projectDir, "docker-compose.yaml")
	envFile := path.Join(projectDir, ".env")

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
		ConfigPaths: []string{composeFilePath},
		WorkDir:     projectDir,
		EnvFiles:    []string{envFile},
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

func CheckUIServiceStarted(url string) error {
	// check response from localhost:3000
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("WrenAI is not started yet")
	}
	return nil
}

func CheckAIServiceStarted(port int) error {
	// health check
	url := fmt.Sprintf("http://localhost:%d/health", port)
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
