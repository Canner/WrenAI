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
	"github.com/pterm/pterm"
)

const (
	DOCKER_COMPOSE_YAML_URL string = "https://gist.githubusercontent.com/wwwy3y3/5fee68a54458a07abbeb573711652292/raw/c8965ceba6eae274d2eec0595fd12b0989880ba3/docker-compose.yaml"
	DOCKER_COMPOSE_ENV_URL  string = "https://gist.githubusercontent.com/wwwy3y3/5fee68a54458a07abbeb573711652292/raw/c8965ceba6eae274d2eec0595fd12b0989880ba3/.env.example"
)

func replaceEnvFileContent(content string, OpenaiApiKey string, port int) string {
	// replace OPENAI_API_KEY
	reg := regexp.MustCompile(`OPENAI_API_KEY=sk-(.*)`)
	str := reg.ReplaceAllString(content, "OPENAI_API_KEY="+OpenaiApiKey)

	// replace PORT
	reg = regexp.MustCompile(`HOST_PORT=(.*)`)
	str = reg.ReplaceAllString(str, "HOST_PORT="+fmt.Sprintf("%d", port))
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

func PrepareDockerFiles(openaiApiKey string, port int, projectDir string) error {
	// download docker-compose file
	composeFile := path.Join(projectDir, "docker-compose.yaml")
	pterm.Info.Println("Downloading docker-compose file to", composeFile)
	err := downloadFile(composeFile, DOCKER_COMPOSE_YAML_URL)
	if err != nil {
		return err
	}

	// download env file
	envFile := path.Join(projectDir, ".env.example")
	pterm.Info.Println("Downloading env file to", envFile)
	err = downloadFile(envFile, DOCKER_COMPOSE_ENV_URL)
	if err != nil {
		return err
	}

	// replace OPENAI_API_KEY=sk-xxxxxx with OPENAI_API_KEY=OpenaiApiKey
	// read the file
	envFileContent, err := os.ReadFile(envFile)
	if err != nil {
		return err
	}

	// replace the content with regex
	newEnvFileContent := replaceEnvFileContent(string(envFileContent), openaiApiKey, port)
	newEnvFile := path.Join(projectDir, ".env")
	// write the file
	err = os.WriteFile(newEnvFile, []byte(newEnvFileContent), 0644)
	if err != nil {
		return err
	}

	// remove the old env file
	err = os.Remove(envFile)
	if err != nil {
		return err
	}

	return nil
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

func ListProcess() ([]types.Container, error) {
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

func CheckWrenAIStarted() error {
	// check response from localhost:3000
	resp, err := http.Get("http://localhost:3000")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("WrenAI is not started yet")
	}

	return nil
}
