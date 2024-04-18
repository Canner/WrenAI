package commands

import (
	"errors"
	"fmt"
	"os"
	"path"
	"strings"
	"time"

	utils "github.com/Canner/WrenAI/wren-launcher/utils"
	"github.com/common-nighthawk/go-figure"
	"github.com/manifoldco/promptui"
	"github.com/pterm/pterm"
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

func AskForTelemetryConsent() (bool, error) {
	// let users know we're asking for telemetry consent
	fmt.Println("WrenAI collects 'ONLY usage data' to improve WrenAI.")
	fmt.Println("You can read more about what we collected at https://docs.getwren.ai/overview/telemetry")

	validate := func(input string) error {
		if input == "y" || input == "n" || input == "" {
			return nil
		}
		return errors.New("invalid input")
	}

	prompt := promptui.Prompt{
		Label:    "Do you agree to help us by sending anonymous usage data? (yes/no, default is y)",
		Validate: validate,
	}

	result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return false, err
	}

	if result == "n" {
		fmt.Println("You have chosen not to consent to telemetry data collection. WrenAI will not collect any usage data.")
		return false, nil
	}

	fmt.Println("Thank you for sharing your usage information with us.")
	return true, nil
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

func Launch() {
	// recover from panic
	defer func() {
		if r := recover(); r != nil {
			pterm.Error.Println("An error occurred:", r)
			fmt.Scanf("h")
		}
	}()

	// print WrenAI header
	fmt.Println(strings.Repeat("=", 55))
	myFigure := figure.NewFigure("WrenAI", "", true)
	myFigure.Print()
	fmt.Println(strings.Repeat("=", 55))

	// ask for OpenAI API key
	pterm.Print("\n")
	apiKey, err := askForAPIKey()

	// ask for telemetry consent
	pterm.Print("\n")
	telemetryConsent, err := AskForTelemetryConsent()

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

	// prepare a project directory
	pterm.Info.Println("Preparing project directory")
	projectDir := prepareProjectDir()

	// download docker-compose file and env file template for WrenAI
	pterm.Info.Println("Downloading docker-compose file and env file")
	// find an available port
	defaultPort := 3000
	port := utils.FindAvailablePort(defaultPort)
	err = utils.PrepareDockerFiles(apiKey, port, projectDir, telemetryConsent)
	if err != nil {
		panic(err)
	}

	// launch WrenAI
	pterm.Info.Println("Launching WrenAI")
	const projectName string = "wrenai"
	err = utils.RunDockerCompose(projectName, projectDir)
	if err != nil {
		panic(err)
	}

	// wait for 10 seconds
	pterm.Info.Println("WrenAI is starting, please wait for a moment...")
	url := fmt.Sprintf("http://localhost:%d", port)
	// wait until checking if CheckWrenAIStarted return without error
	// if timeout 2 minutes, panic
	timeoutTime := time.Now().Add(2 * time.Minute)
	for {
		if time.Now().After(timeoutTime) {
			panic("Timeout")
		}

		// check if WrenAI is started
		err = utils.CheckWrenAIStarted(url)
		if err == nil {
			break
		}
		time.Sleep(5 * time.Second)
	}

	// open browser
	pterm.Info.Println("Opening browser")
	utils.Openbrowser(url)

	pterm.Info.Println("You can now safely close this terminal window")
	fmt.Scanf("h")
}
