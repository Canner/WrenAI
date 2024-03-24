package commands

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strings"
	"time"

	utils "github.com/Canner/WrenAI/wren-launcher/utils"
	"github.com/common-nighthawk/go-figure"
	"github.com/manifoldco/promptui"
)

func prepareProjectDir() string {
	// create a project directory under ~/.wrenai
	homedir, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}

	projectDir := path.Join(homedir, ".wrenai")

	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		os.Mkdir(projectDir, 0755)
	}

	return projectDir
}

func askForAPIKey() (string, error) {
	// let users know we're asking for an API key
	fmt.Println("Please provide your OpenAI API key")

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

func openbrowser(url string) error {
	var err error

	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	return err
}

func Launch() {
	// print WrenAI header
	fmt.Println(strings.Repeat("=", 55))
	myFigure := figure.NewFigure("WrenAI", "", true)
	myFigure.Print()
	fmt.Println(strings.Repeat("=", 55))

	// ask for OpenAI API key
	apiKey, err := askForAPIKey()

	if err != nil {
		fmt.Println("Failed to get API key")
		return
	}

	fmt.Println("API key:", apiKey)

	// check if docker daemon is running, if not, open it and loop to check again
	fmt.Println("Checking if Docker daemon is running")
	for {
		_, err = utils.CheckDockerDaemonRunning()
		if err == nil {
			break
		}

		fmt.Println("Docker daemon is not running, opening Docker Desktop")
		err = utils.OpenDockerDaemon()
		if err != nil {
			panic(err)
		}

		time.Sleep(5 * time.Second)
	}

	// prepare a project directory
	fmt.Println("Preparing project directory")
	projectDir := prepareProjectDir()

	// download docker-compose file and env file template for WrenAI
	fmt.Println("Downloading docker-compose file and env file")
	err = utils.PrepareDockerFiles(apiKey, projectDir)
	if err != nil {
		panic(err)
	}

	// launch WrenAI
	fmt.Println("Launching WrenAI")
	const projectName string = "wrenai"
	err = utils.RunDockerCompose(projectName, projectDir)
	if err != nil {
		panic(err)
	}

	// wait for 10 seconds
	fmt.Println("WrenAI is starting, please wait for a moment...")
	// wait until checking if CheckWrenAIStarted return without error
	// if timeout 2 minutes, panic
	timeoutTime := time.Now().Add(2 * time.Minute)
	for {
		if time.Now().After(timeoutTime) {
			panic("Timeout")
		}

		// check if WrenAI is started
		err = utils.CheckWrenAIStarted()
		if err == nil {
			break
		}
		time.Sleep(5 * time.Second)
	}

	// open browser
	fmt.Println("Opening browser")
	openbrowser("http://localhost:3000")

	fmt.Scanf("h")
}
