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

	"github.com/sethvargo/go-password/password"
)

const (
	DOCKER_COMPOSE_YAML_URL string = "https://gist.githubusercontent.com/wwwy3y3/5fee68a54458a07abbeb573711652292/raw/d08126960f529e021b69d780d6b84f8ba9bee779/docker-compose.yaml"
	DOCKER_COMPOSE_ENV_URL  string = "https://gist.githubusercontent.com/wwwy3y3/5fee68a54458a07abbeb573711652292/raw/d08126960f529e021b69d780d6b84f8ba9bee779/.env.example"
)

func replaceEnvFileContent(content string, OpenaiApiKey string, port int, pg_password string) string {
	// replace OPENAI_API_KEY
	reg := regexp.MustCompile(`OPENAI_API_KEY=sk-(.*)`)
	str := reg.ReplaceAllString(content, "OPENAI_API_KEY="+OpenaiApiKey)

	// replace PORT
	reg = regexp.MustCompile(`HOST_PORT=(.*)`)
	str = reg.ReplaceAllString(str, "HOST_PORT="+fmt.Sprintf("%d", port))

	// replace PG_PASSWORD
	reg = regexp.MustCompile(`PG_PASSWORD=(.*)`)
	str = reg.ReplaceAllString(str, "PG_PASSWORD="+pg_password)
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

func PrepareDockerFiles(openaiApiKey string, port int, projectDir string) error {
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
	newEnvFileContent := replaceEnvFileContent(string(envFileContent), openaiApiKey, port, pg_pwd)
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

func CheckWrenAIStarted(url string) error {
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
